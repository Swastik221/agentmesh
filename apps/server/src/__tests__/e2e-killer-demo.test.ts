import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { demoOrchestrator, DemoStage } from '../demo/demo-orchestrator.js';
import { PolicyDecision, PaymentStatus, ApprovalStatus } from '@prisma/client';
import { policyService } from '../services/policy.service.js';
import { approvalService } from '../services/approval.service.js';
import { artifactService } from '../services/artifact.service.js';
import { sessionService } from '../auth/session.service.js';

describe('PRD-38 Killer Two-Agent E2E Demo Integration Test', () => {
  beforeEach(async () => {
    // Clean database tables safely
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

  it('1. Complete 15-Stage E2E Workflow: Identity → ENS → Agent A → Task → Policy → Approval → x402 → Hedera → Execution → Artifact A → Exchange → Agent B → Artifact B', async () => {
    const result = await demoOrchestrator.runDemo({ mockHederaSettlement: true });

    // Assert all 15 stage labels are present in exact order
    const expectedStages: DemoStage[] = [
      'IDENTITY_VERIFIED',
      'AGENTS_READY',
      'TASK_CREATED',
      'POLICY_APPROVAL_REQUIRED',
      'EXECUTION_BLOCKED',
      'APPROVAL_CREATED',
      'APPROVAL_APPROVED',
      'PAYMENT_REQUIRED',
      'PAYMENT_VERIFIED',
      'PAYMENT_SETTLED',
      'CAPABILITY_EXECUTED',
      'ARTIFACT_CREATED',
      'ARTIFACT_EXCHANGED',
      'AGENT_B_PROCESSED',
      'DEMO_COMPLETE',
    ];

    expect(result.stages).toEqual(expectedStages);

    // Database assertions: Phase A (Identity)
    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    expect(user).toBeDefined();
    const session = await sessionService.validateSession(result.sessionId);
    expect(session.user.id).toBe(result.userId);

    // Database assertions: Phase B (Agents & Project)
    const project = await prisma.project.findUnique({ where: { id: result.projectId } });
    expect(project).toBeDefined();

    const agentA = await prisma.agent.findUnique({ where: { id: result.agentAId } });
    expect(agentA?.projectId).toBe(result.projectId);
    expect(agentA?.ensName).toBe('researcher.eth');

    const agentB = await prisma.agent.findUnique({ where: { id: result.agentBId } });
    expect(agentB?.projectId).toBe(result.projectId);

    // Database assertions: Phase C (Task)
    const task = await prisma.task.findUnique({ where: { id: result.taskId } });
    expect(task?.preferredAgentId).toBe(result.agentAId);

    // Database assertions: Phase D & E (Policy & Approval)
    const policy = await prisma.policy.findUnique({ where: { id: result.policyId } });
    expect(policy?.decision).toBe(PolicyDecision.APPROVAL_REQUIRED);

    const approval = await prisma.approvalRequest.findUnique({ where: { id: result.approvalId } });
    expect(approval?.status).toBe(ApprovalStatus.APPROVED);
    expect(approval?.requestedByUserId).toBe(result.userId);
    expect(approval?.resolvedByUserId).toBe(result.userId);

    // Database assertions: Phase F (x402 Payment & Hedera Settlement)
    const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
    expect(payment?.status).toBe(PaymentStatus.SETTLED);
    expect(payment?.transactionReference).toBe(result.transactionReference);
    expect(payment?.transactionReference).toBe('MOCK-HEDERA-SETTLEMENT');

    // Database assertions: Phase H (Artifact A by Agent A)
    const artifactA = await prisma.artifact.findUnique({ where: { id: result.artifactAId } });
    expect(artifactA?.agentId).toBe(result.agentAId);
    expect(artifactA?.type).toBe('audit_report');

    // Database assertions: Phase I (Agent-to-Agent Exchange Dependency)
    const dependency = await prisma.taskDependency.findFirst({
      where: { artifactId: result.artifactAId },
    });
    expect(dependency).toBeDefined();

    // Database assertions: Phase J (Artifact B by Agent B)
    const artifactB = await prisma.artifact.findUnique({ where: { id: result.artifactBId } });
    expect(artifactB?.agentId).toBe(result.agentBId);
    expect(artifactB?.type).toBe('remediation_plan');
    const payloadB = artifactB?.payload as { sourceArtifactId: string };
    expect(payloadB.sourceArtifactId).toBe(result.artifactAId);
  });

  it('2. Security & Failure-Proofing: Rejects pre-approval execution, cross-project approval, and unauthorized artifact access', async () => {
    // Setup isolated user & project A
    const userA = await prisma.user.create({
      data: { walletAddress: '0x2222222222222222222222222222222222222222' },
    });
    const projA = await prisma.project.create({
      data: { name: 'Security Project A', ownerId: userA.id },
    });
    await prisma.projectMember.create({
      data: { projectId: projA.id, userId: userA.id, role: 'OWNER' },
    });

    // Create policy requiring approval
    const polA = await policyService.createPolicy(projA.id, userA.id, {
      name: 'Deny unapproved execution',
      action: 'task.execute',
      enabled: true,
      decision: PolicyDecision.APPROVAL_REQUIRED,
    });

    // 1. Verify policy evaluation blocks execution before approval
    const evalBefore = await policyService.evaluateAction(projA.id, 'task.execute');
    expect(evalBefore.decision).toBe(PolicyDecision.APPROVAL_REQUIRED);

    // 2. Setup isolated user B & project B
    const userB = await prisma.user.create({
      data: { walletAddress: '0x3333333333333333333333333333333333333333' },
    });

    const appReqA = await approvalService.createApprovalRequest(projA.id, userA.id, {
      projectId: projA.id,
      action: 'task.execute',
      policyId: polA.id,
      reason: 'Requires approval',
    });

    // Verify non-member user B CANNOT approve User A request (Cross-project rejection)
    await expect(approvalService.approveRequest(appReqA.id, userB.id)).rejects.toThrow(
      'User is not a member of this project',
    );

    // Create Agent A in Project A for artifact creation
    const agentA = await prisma.agent.create({
      data: {
        name: 'Agent A (Security Audit)',
        provider: 'claude',
        projectId: projA.id,
        ownerId: userA.id,
        status: 'ONLINE',
      },
    });

    // Verify non-member user B CANNOT access Project A artifacts
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
