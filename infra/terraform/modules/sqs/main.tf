# ==============================================================================
# MUXARO SQS Module: Media Job Distribution Queue with Dead-Letter Policy
# ==============================================================================

variable "environment" {
  type = string
}

# ------------------------------------------------------------------------------
# Dead Letter Queue (DLQ)
# ------------------------------------------------------------------------------
resource "aws_sqs_queue" "dlq" {
  name                      = "muxaro-${var.environment}-media-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days forensic retention
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "${var.environment}-media-jobs-dlq"
  }
}

# ------------------------------------------------------------------------------
# Primary Media Processing Jobs Queue
# ------------------------------------------------------------------------------
resource "aws_sqs_queue" "media_jobs" {
  name                       = "muxaro-${var.environment}-media-jobs"
  visibility_timeout_seconds = 180 # 3 minutes (allows worker transcoding headroom)
  message_retention_seconds  = 86400 # 24 hours
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3 # After 3 attempts, poison pill jobs move to DLQ
  })

  tags = {
    Name = "${var.environment}-media-jobs-queue"
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "media_jobs_queue_url" {
  value = aws_sqs_queue.media_jobs.url
}

output "media_jobs_queue_arn" {
  value = aws_sqs_queue.media_jobs.arn
}

output "media_jobs_dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "media_jobs_dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}
