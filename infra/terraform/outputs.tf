# ==============================================================================
# MUXARO Root Module Outputs
# ==============================================================================

output "alb_dns_name" {
  description = "Public DNS name of AWS Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "database_endpoint" {
  description = "RDS PostgreSQL Primary Endpoint"
  value       = module.database.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis Primary Cluster Endpoint"
  value       = module.redis.primary_endpoint_address
}

output "sqs_media_jobs_url" {
  description = "SQS Media Processing Jobs Queue URL"
  value       = module.sqs.media_jobs_queue_url
}

output "sqs_media_jobs_dlq_url" {
  description = "SQS Media Processing Dead-Letter Queue URL"
  value       = module.sqs.media_jobs_dlq_url
}

output "s3_uploads_bucket" {
  description = "S3 Uploads Bucket Name"
  value       = module.s3.uploads_bucket_name
}

output "s3_artifacts_bucket" {
  description = "S3 Processed Artifacts Bucket Name"
  value       = module.s3.artifacts_bucket_name
}

output "worker_autoscaling_group" {
  description = "Media Transcoding EC2 Auto Scaling Group Name"
  value       = module.workers.autoscaling_group_name
}
