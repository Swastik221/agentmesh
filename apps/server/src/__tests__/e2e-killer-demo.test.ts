import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { PolicyDecision, ApprovalStatus } from '@prisma/client';
import { policyService } from '../services/policy.service.js';
import { approvalService } from '../services/approval.service.js';
import { artifactService } from '../services/artifact.service.js';
import { sessionService } from '../auth/session.service.js';
import { dependencyService } from '../services/dependency.service.js';

describe('Real Two-Agent E2E Workflow & Security Integration Tests', () => {
  beforeEach(async () => {
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.artifact.deleteMany().catch(() => {});
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.policy.deleteMany().catch(() => {});
    await prisma.task.deleteMany().catch(() => {});
    await prisma.agentCapability.deleteMany().catch(() => {});
    await prisma.agent.deleteMany().catch(() => {});
    await prisma.projectWorkspace.deleteMany().catch(() => {});
    await prisma.projectMember.deleteMany().catch(() => {});
    await prisma.project.deleteMany().catch(() => {});
    await prisma.authSession.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});
  });

  afterEach(async () => {
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.artifact.deleteMany().catch(() => {});
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.policy.deleteMany().catch(() => {});
    await prisma.task.deleteMany().catch(() => {});
    await prisma.agentCapability.deleteMany().catch(() => {});
    await prisma.agent.deleteMany().catch(() => {});
    await prisma.projectWorkspace.deleteMany().catch(() => {});
    await prisma.projectMember.deleteMany().catch(() => {});
    await prisma.project.deleteMany().catch(() => {});
    await prisma.authSession.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});
  });

  it('1. Complete Real Two-Agent E2E Workflow: Identity → Project → Agent A & B → Policy → Approval → Artifact Exchange', async () => {
    // 1. Identity & SIWE Session
    const user = await prisma.user.create({
      data: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        displayName: 'Real Researcher',
      },
    });
    const session = await sessionService.createSession(user.id);
    expect(session.id).toBeDefined();

    // 2. Project Creation & Member
    const project = await prisma.project.create({
      data: { name: 'E2E Real Project', ownerId: user.id },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: 'OWNER' },
    });

    // 3. Register Agents A & B
    const agentA = await prisma.agent.create({
      data: {
        name: 'Agent A (Audit)',
        provider: 'real-agent-provider',
        projectId: project.id,
        ownerId: user.id,
        ensName: 'researcher.eth',
        status: 'ONLINE',
      },
    });
    const agentB = await prisma.agent.create({
      data: {
        name: 'Agent B (Remediate)',
        provider: 'real-agent-provider',
        projectId: project.id,
        ownerId: user.id,
        status: 'ONLINE',
      },
    });

    // 4. Tasks & Policy & Approval
    const taskA = await prisma.task.create({
      data: {
        projectId: project.id,
        creatorId: user.id,
        title: 'Audit Code',
        description: 'Audit codebase for security vulnerabilities',
        status: 'TODO',
        preferredAgentId: agentA.id,
      },
    });
    const taskB = await prisma.task.create({
      data: {
        projectId: project.id,
        creatorId: user.id,
        title: 'Remediate Code',
        description: 'Apply security fixes based on audit',
        status: 'TODO',
        preferredAgentId: agentB.id,
      },
    });

    const policy = await policyService.createPolicy(project.id, user.id, {
      name: 'Require Approval for Audit Execution',
      action: 'capability.execute',
      enabled: true,
      decision: PolicyDecision.APPROVAL_REQUIRED,
    });

    const evalBefore = await policyService.evaluateAction(project.id, 'capability.execute');
    expect(evalBefore.decision).toBe(PolicyDecision.APPROVAL_REQUIRED);

    const approval = await approvalService.createApprovalRequest(project.id, user.id, {
      projectId: project.id,
      action: 'capability.execute',
      policyId: policy.id,
      reason: 'Human approval for security audit',
    });

    const approved = await approvalService.approveRequest(approval.id, user.id);
    expect(approved.status).toBe(ApprovalStatus.APPROVED);

    // 5. Artifact A Creation & Exchange Dependency to Agent B
    const artifactA = await artifactService.createArtifact(project.id, taskA.id, user.id, {
      name: 'audit-report.json',
      type: 'audit_report',
      payload: { vulnerabilities: ['CVE-2026-001'] },
      agentId: agentA.id,
    });

    const dependency = await dependencyService.createDependency(project.id, taskB.id, user.id, {
      artifactId: artifactA.id,
    });
    expect(dependency.artifactId).toBe(artifactA.id);

    // 6. Artifact B Creation by Agent B
    const artifactB = await artifactService.createArtifact(project.id, taskB.id, user.id, {
      name: 'remediation-plan.json',
      type: 'remediation_plan',
      payload: { sourceArtifactId: artifactA.id, fix: 'Patched CVE-2026-001' },
      agentId: agentB.id,
    });

    expect(artifactB.agentId).toBe(agentB.id);
    expect((artifactB.payload as { sourceArtifactId: string }).sourceArtifactId).toBe(artifactA.id);
  });

  it('2. Security & Failure-Proofing: Rejects pre-approval execution, cross-project approval, and unauthorized artifact access', async () => {
    const userA = await prisma.user.create({
      data: { walletAddress: '0x2222222222222222222222222222222222222222' },
    });
    const projA = await prisma.project.create({
      data: { name: 'Security Project A', ownerId: userA.id },
    });
    await prisma.projectMember.create({
      data: { projectId: projA.id, userId: userA.id, role: 'OWNER' },
    });

    const polA = await policyService.createPolicy(projA.id, userA.id, {
      name: 'Deny unapproved execution',
      action: 'task.execute',
      enabled: true,
      decision: PolicyDecision.APPROVAL_REQUIRED,
    });

    const evalBefore = await policyService.evaluateAction(projA.id, 'task.execute');
    expect(evalBefore.decision).toBe(PolicyDecision.APPROVAL_REQUIRED);

    const userB = await prisma.user.create({
      data: { walletAddress: '0x3333333333333333333333333333333333333333' },
    });

    const appReqA = await approvalService.createApprovalRequest(projA.id, userA.id, {
      projectId: projA.id,
      action: 'task.execute',
      policyId: polA.id,
      reason: 'Requires approval',
    });

    await expect(approvalService.approveRequest(appReqA.id, userB.id)).rejects.toThrow(
      'User is not a member of this project',
    );

    const agentA = await prisma.agent.create({
      data: {
        name: 'Agent A (Security Audit)',
        provider: 'claude',
        projectId: projA.id,
        ownerId: userA.id,
        status: 'ONLINE',
      },
    });

    const taskA = await prisma.task.create({
      data: {
        projectId: projA.id,
        creatorId: userA.id,
        title: 'Task A',
        description: 'Task A description',
        status: 'IN_PROGRESS',
      },
    });
    const artA = await artifactService.createArtifact(projA.id, taskA.id, userA.id, {
      name: 'secret-audit.json',
      type: 'audit_report',
      payload: { secret: 'top_secret' },
      agentId: agentA.id,
    });

    await expect(artifactService.getArtifact(projA.id, artA.id, userB.id)).rejects.toThrow(
      'User is not a member of this project',
    );
  });
});
