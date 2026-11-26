import crypto from 'node:crypto';
import {
  parseAgentMeshMessage,
  createAgentMeshMessage,
  AgentMeshMessageType,
  AgentMeshProtocolError,
  AgentMeshProtocolErrorCode,
  AgentHandshakeMessage,
  AgentMeshMessage,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';

import { sessionService } from '../auth/session.service.js';
import { ConnectionMetadata } from '../websocket/websocket.types.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { HandshakeErrorCode } from './handshake.errors.js';
import { agentConnectTokenService } from '../services/agent-connect-token.service.js';

export interface HandshakeResult {
  success: boolean;
  message: AgentMeshMessage;
}

export class HandshakeService {
  async processHandshake(
    connection: ConnectionMetadata,
    rawMessage: unknown,
  ): Promise<HandshakeResult> {
    // Rule 12: Duplicate handshake on the same connection
    if (connection.authenticated && connection.agentId) {
      return {
        success: false,
        message: this.createRejection(
          connection,
          HandshakeErrorCode.HANDSHAKE_ALREADY_COMPLETED,
          'Handshake has already been completed for this connection',
          undefined,
        ),
      };
    }

    // Step 1 & 2: Parse and validate AgentMesh protocol message
    let handshakeMsg: AgentHandshakeMessage;
    try {
      const parsed = parseAgentMeshMessage(rawMessage);

      if (parsed.type !== AgentMeshMessageType.AGENT_HANDSHAKE) {
        return {
          success: false,
          message: this.createRejection(
            connection,
            HandshakeErrorCode.HANDSHAKE_REQUIRED,
            `Expected message type 'agent.handshake', got '${parsed.type}'`,
            (rawMessage as { id?: string })?.id,
          ),
        };
      }

      handshakeMsg = parsed as AgentHandshakeMessage;
    } catch (error) {
      if (error instanceof AgentMeshProtocolError) {
        if (error.code === AgentMeshProtocolErrorCode.INVALID_VERSION) {
          return {
            success: false,
            message: this.createRejection(
              connection,
              HandshakeErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
              error.message,
              (rawMessage as { id?: string })?.id,
            ),
          };
        }
      }

      const messageText = error instanceof Error ? error.message : 'Invalid handshake message';
      return {
        success: false,
        message: this.createRejection(
          connection,
          'INVALID_MESSAGE',
          messageText,
          (rawMessage as { id?: string })?.id,
        ),
      };
    }

    const { payload } = handshakeMsg;

    // Step 3: Resolve the authenticated user.
    //
    // Two credentials are accepted, and only two. A browser client presents its
    // SIWE session, exactly as before. An agent process presents a connect
    // token, which the upgrade already validated and which names a single agent
    // in a single project. The token resolves to the user who minted it, and
    // every ownership, project and membership check below then runs unchanged
    // against that user, so the token can never reach further than the member
    // who created it could reach themselves.
    let authenticatedUserId: string;

    if (connection.connectToken) {
      if (connection.connectToken.agentId !== payload.agentId) {
        return {
          success: false,
          message: this.createRejection(
            connection,
            HandshakeErrorCode.AGENT_NOT_OWNED,
            `Connect token is scoped to agent '${connection.connectToken.agentId}', not '${payload.agentId}'`,
            handshakeMsg.id,
          ),
        };
      }
      if (connection.connectToken.projectId !== connection.projectId) {
        return {
          success: false,
          message: this.createRejection(
            connection,
            HandshakeErrorCode.AGENT_PROJECT_MISMATCH,
            `Connect token is scoped to project '${connection.connectToken.projectId}', not '${connection.projectId}'`,
            handshakeMsg.id,
          ),
        };
      }
      authenticatedUserId = connection.connectToken.issuedByUserId;
    } else {
      if (!connection.httpSessionId) {
        return {
          success: false,
          message: this.createRejection(
            connection,
            HandshakeErrorCode.UNAUTHENTICATED,
            'Authentication required. No session cookie provided.',
            handshakeMsg.id,
          ),
        };
      }

      try {
        const session = await sessionService.validateSession(connection.httpSessionId);
        authenticatedUserId = session.user.id;
      } catch {
        return {
          success: false,
          message: this.createRejection(
            connection,
            HandshakeErrorCode.UNAUTHENTICATED,
            'Invalid or expired authentication session',
            handshakeMsg.id,
          ),
        };
      }
    }

    // Step 4: Find agent in database
    const agent = await prisma.agent.findUnique({
      where: { id: payload.agentId },
      include: { capabilities: true },
    });

    if (!agent) {
      return {
        success: false,
        message: this.createRejection(
          connection,
          HandshakeErrorCode.AGENT_NOT_FOUND,
          `Agent '${payload.agentId}' not found`,
          handshakeMsg.id,
        ),
      };
    }

    // Step 5: Verify ownership (agent.ownerId === authenticatedUser.id)
    if (agent.ownerId !== authenticatedUserId) {
      return {
        success: false,
        message: this.createRejection(
          connection,
          HandshakeErrorCode.AGENT_NOT_OWNED,
          `Agent '${payload.agentId}' is not owned by the authenticated user`,
          handshakeMsg.id,
        ),
      };
    }

    // Step 6: Verify project (agent.projectId === websocket.projectId)
    if (agent.projectId !== connection.projectId) {
      return {
        success: false,
        message: this.createRejection(
          connection,
          HandshakeErrorCode.AGENT_PROJECT_MISMATCH,
          `Agent '${payload.agentId}' belongs to project '${agent.projectId}', not '${connection.projectId}'`,
          handshakeMsg.id,
        ),
      };
    }

    // Step 7: Verify project membership
    const project = await prisma.project.findUnique({
      where: { id: connection.projectId },
    });
    const member = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: connection.projectId,
          userId: authenticatedUserId,
        },
      },
    });

    if (!member && project?.ownerId !== authenticatedUserId) {
      return {
        success: false,
        message: this.createRejection(
          connection,
          HandshakeErrorCode.PROJECT_ACCESS_DENIED,
          `Authenticated user is not an active member of project '${connection.projectId}'`,
          handshakeMsg.id,
        ),
      };
    }

    // Step 8: Capability verification
    const registeredCaps = agent.capabilities.map((c) => c.capability.trim().toLowerCase());

    if (payload.capabilities && payload.capabilities.length > 0) {
      for (const reqCap of payload.capabilities) {
        const normalizedReqCap = reqCap.trim().toLowerCase();
        if (!registeredCaps.includes(normalizedReqCap)) {
          return {
            success: false,
            message: this.createRejection(
              connection,
              HandshakeErrorCode.INVALID_CAPABILITIES,
              `Capability '${reqCap}' is not registered for agent '${agent.id}'`,
              handshakeMsg.id,
            ),
          };
        }
      }
    }

    // Step 9: Establish authenticated agent session
    const sessionId = crypto.randomUUID();
    connection.authenticated = true;
    connection.userId = authenticatedUserId;
    connection.agentId = agent.id;
    connection.sessionId = sessionId;
    connection.connectionRole = payload.connectionRole ?? 'executor';

    // Only an executor connection can take work, so only it changes the
    // agent's status or triggers dispatch of queued tasks.
    if (connection.connectionRole === 'executor') {
      if (agent.status === 'OFFLINE') {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { status: 'ONLINE' },
        });
      }

      const { connectorService } = await import('../connector/connector.service.js');
      void connectorService.onAgentConnected(agent.id, connection.projectId).catch(() => {});
    }

    // A fresh credential for reconnecting once the original connect token has
    // expired. Best effort: failing to mint one must not fail the handshake.
    const resume = await agentConnectTokenService
      .issueResume(agent.id, connection.projectId, authenticatedUserId)
      .catch(() => null);

    const acceptedMessage = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED,
      projectId: connection.projectId,
      senderId: 'server',
      recipientId: agent.id,
      correlationId: handshakeMsg.id,
      payload: {
        agentId: agent.id,
        sessionId,
        projectId: connection.projectId,
        capabilities: registeredCaps,
        ...(resume && {
          resumeToken: resume.token,
          resumeTokenExpiresAt: resume.expiresAt.toISOString(),
        }),
      },
    });

    return {
      success: true,
      message: acceptedMessage,
    };
  }

  async handleDisconnection(connection: ConnectionMetadata): Promise<void> {
    if (!connection.authenticated || !connection.agentId) {
      return;
    }
    if (connection.connectionRole && connection.connectionRole !== 'executor') {
      return;
    }

    const remainingActiveConnections = connectionManager.getActiveAgentConnectionsCount(
      connection.agentId,
      connection.connectionId,
    );

    if (remainingActiveConnections === 0) {
      await prisma.agent
        .update({
          where: { id: connection.agentId },
          data: { status: 'OFFLINE' },
        })
        .catch(() => {});
    }
  }

  createRejection(
    connection: ConnectionMetadata,
    code: string,
    messageText: string,
    correlationId?: string,
  ): AgentMeshMessage {
    return createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED,
      projectId: connection.projectId,
      senderId: 'server',
      ...(correlationId && { correlationId }),
      payload: {
        code,
        message: messageText,
      },
    });
  }
}

export const handshakeService = new HandshakeService();
