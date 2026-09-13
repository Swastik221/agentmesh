-- An open offer on the shared task board: the moment the offer stops being
-- open to any agent and the coordinator assigns it instead. Null means the
-- task was never offered, or has already been claimed or assigned.
ALTER TABLE "tasks" ADD COLUMN "offerExpiresAt" TIMESTAMP(3);

-- The sweeper queries due offers on a timer, so give it an index to ride.
CREATE INDEX "tasks_offerExpiresAt_idx" ON "tasks"("offerExpiresAt");
