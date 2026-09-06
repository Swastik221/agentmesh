import { WebSocket } from 'ws';
import {
  parseAgentMeshMessage,
  createAgentMeshMessage,
  AgentMeshMessageType,
  AgentMeshProtocolError,
  AgentMeshMessage,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { ConnectionMetadata } from '../websocket/websocket.types.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { MessagingErrorCode } from './messaging.errors.js';

export interface MessagingResult {
  success: boolean;
  error?: AgentMeshMessage;
}

export class MessagingService {
  async processAgentMessage(
    connection: ConnectionMetadata,
    rawMessage: unknown,
  ): Promise<MessagingResult> {
    const rawId = typeof rawMessage === 'object' && rawMessage !== null ? (rawMessage as { id?: string }).id : undefined;

    // Step 1: Verify connection has completed handshake
    if (!connection.authenticated || !connection.agentId) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.HANDSHAKE_REQUIRED,
          'Handshake required before sending application messages',
          rawId,
        ),
      };
    }

    // Step 2: Parse protocol message using canonical parser
    let agentMessage: AgentMeshMessage;
    try {
      agentMessage = parseAgentMeshMessage(rawMessage);
    } catch (error) {
      if (error instanceof AgentMeshProtocolError) {
        return {
          success: false,
          error: this.createErrorMessage(
            connection,
            error.code,
            error.message,
            rawId,
          ),
        };
      }
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          'INVALID_MESSAGE',
          'Invalid agent.message payload',
          rawId,
        ),
      };
    }

    if (agentMessage.type !== AgentMeshMessageType.AGENT_MESSAGE) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          'INVALID_MESSAGE',
          `Expected message type 'agent.message', got '${agentMessage.type}'`,
          agentMessage.id,
        ),
      };
    }

    // Step 3: Authoritative Sender Identity check (Section 6)
    if (agentMessage.senderId !== connection.agentId) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.SENDER_ID_MISMATCH,
          `Sender ID '${agentMessage.senderId}' does not match authenticated agent ID '${connection.agentId}'`,
          agentMessage.id,
        ),
      };
    }

    // Step 4: Authoritative Project ID check (Section 14)
    if (agentMessage.projectId !== connection.projectId) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.PROJECT_MISMATCH,
          `Message project ID '${agentMessage.projectId}' does not match connection project ID '${connection.projectId}'`,
          agentMessage.id,
        ),
      };
    }

    // Step 5: Recipient ID Presence (Section 7)
    if (!agentMessage.recipientId || agentMessage.recipientId.trim() === '') {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.RECIPIENT_NOT_FOUND,
          'Recipient ID is required for direct agent messaging',
          agentMessage.id,
        ),
      };
    }

    // Step 6: Recipient existence check (Section 7)
    const recipientAgent = await prisma.agent.findUnique({
      where: { id: agentMessage.recipientId },
    });

    if (!recipientAgent) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.RECIPIENT_NOT_FOUND,
          `Recipient agent '${agentMessage.recipientId}' not found`,
          agentMessage.id,
        ),
      };
    }

    // Step 7: Recipient project alignment check (Section 7)
    if (recipientAgent.projectId !== connection.projectId) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.RECIPIENT_PROJECT_MISMATCH,
          `Recipient agent '${agentMessage.recipientId}' belongs to another project`,
          agentMessage.id,
        ),
      };
    }

    // Step 8: Find active recipient connections (Section 9)
    const recipientConnections = connectionManager
      .getAuthenticatedAgentConnections(recipientAgent.id)
      .filter((c) => c.socket.readyState === WebSocket.OPEN);

    if (recipientConnections.length === 0) {
      return {
        success: false,
        error: this.createErrorMessage(
          connection,
          MessagingErrorCode.RECIPIENT_OFFLINE,
          'Recipient agent is not currently connected.',
          agentMessage.id,
          true,
        ),
      };
    }

    // Step 9: Deliver exact original message to all recipient connections (Section 9, 12, 13, 20)
    const dataToSend = JSON.stringify(agentMessage);
    for (const recipientConn of recipientConnections) {
      recipientConn.socket.send(dataToSend);
    }

    return {
      success: true,
    };
  }

  private createErrorMessage(
    connection: ConnectionMetadata,
    code: string,
    messageText: string,
    correlationId?: string,
    retryable?: boolean,
  ): AgentMeshMessage {
    return createAgentMeshMessage({
      type: AgentMeshMessageType.ERROR,
      projectId: connection.projectId,
      senderId: 'server',
      ...(connection.agentId && { recipientId: connection.agentId }),
      ...(correlationId && { correlationId }),
      payload: {
        code,
        message: messageText,
        ...(retryable !== undefined && { retryable }),
      },
    });
  }
}

export const messagingService = new MessagingService();
