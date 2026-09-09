import { PolicyDecision, Policy } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { CreatePolicyInput, UpdatePolicyInput } from '../schemas/policy.schema.js';

export class PolicyService {
  async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('User is not a member of this project');
    }
  }

  /**
   * Evaluates project-scoped policies for a given action.
   * Deterministic precedence: DENY > APPROVAL_REQUIRED > ALLOW.
   * Default (no matching policy) => ALLOW.
   */
  async evaluateAction(
    projectId: string,
    action: string,
  ): Promise<{ decision: PolicyDecision; matchedPolicies: Policy[] }> {
    const policies = await prisma.policy.findMany({
      where: {
        projectId,
        action,
        enabled: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (policies.length === 0) {
      return { decision: PolicyDecision.ALLOW, matchedPolicies: [] };
    }

    const hasDeny = policies.some((p) => p.decision === PolicyDecision.DENY);
    if (hasDeny) {
      return { decision: PolicyDecision.DENY, matchedPolicies: policies };
    }

    const hasApprovalRequired = policies.some(
      (p) => p.decision === PolicyDecision.APPROVAL_REQUIRED,
    );
    if (hasApprovalRequired) {
      return { decision: PolicyDecision.APPROVAL_REQUIRED, matchedPolicies: policies };
    }

    return { decision: PolicyDecision.ALLOW, matchedPolicies: policies };
  }

  async createPolicy(
    projectId: string,
    userId: string,
    data: CreatePolicyInput,
  ): Promise<Policy> {
    await this.verifyProjectMembership(projectId, userId);

    return await prisma.policy.create({
      data: {
        projectId,
        name: data.name,
        description: data.description || null,
        action: data.action,
        decision: data.decision,
        enabled: data.enabled ?? true,
      },
    });
  }

  async listPolicies(projectId: string, userId: string): Promise<Policy[]> {
    await this.verifyProjectMembership(projectId, userId);

    return await prisma.policy.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPolicyById(projectId: string, policyId: string, userId: string): Promise<Policy> {
    await this.verifyProjectMembership(projectId, userId);

    const policy = await prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!policy || policy.projectId !== projectId) {
      throw new NotFoundError(`Policy with ID '${policyId}' not found`);
    }

    return policy;
  }

  async updatePolicy(
    projectId: string,
    policyId: string,
    userId: string,
    data: UpdatePolicyInput,
  ): Promise<Policy> {
    await this.verifyProjectMembership(projectId, userId);

    const existing = await prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!existing || existing.projectId !== projectId) {
      throw new NotFoundError(`Policy with ID '${policyId}' not found`);
    }

    return await prisma.policy.update({
      where: { id: policyId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.action !== undefined && { action: data.action }),
        ...(data.decision !== undefined && { decision: data.decision }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
    });
  }

  async deletePolicy(projectId: string, policyId: string, userId: string): Promise<Policy> {
    await this.verifyProjectMembership(projectId, userId);

    const existing = await prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!existing || existing.projectId !== projectId) {
      throw new NotFoundError(`Policy with ID '${policyId}' not found`);
    }

    return await prisma.policy.delete({
      where: { id: policyId },
    });
  }
}

export const policyService = new PolicyService();
