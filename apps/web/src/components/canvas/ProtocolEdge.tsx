import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export function ProtocolEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });

  const edgeType = (data?.protocolType as string) || 'default';
  const isClaimed = edgeType === 'TASK_CLAIMED' || label?.toString().includes('claimed');
  const isApproval = edgeType === 'APPROVAL_REQUIRED' || edgeType === 'APPROVAL_GRANTED' || label?.toString().includes('approval') || label?.toString().includes('deploy');
  const isArtifact = edgeType === 'ARTIFACT_PUBLISHED' || label?.toString().includes('.json') || label?.toString().includes('schema');

  let labelBadgeClass = 'mesh-edge-label--proposal';
  if (isClaimed) labelBadgeClass = 'mesh-edge-label--claimed';
  else if (isApproval) labelBadgeClass = 'mesh-edge-label--approval';
  else if (isArtifact) labelBadgeClass = 'mesh-edge-label--dependency';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            className={`nodrag nopan mesh-edge-label ${labelBadgeClass}`}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
