# ==============================================================================
# MUXARO Cloud Infrastructure: Root Module Orchestration
# Flow: Cloudflare -> AWS ALB -> ECS (Web & API) -> SQS -> Workers -> S3
# ==============================================================================

module "networking" {
  source             = "./modules/networking"
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "s3" {
  source      = "./modules/s3"
  environment = var.environment
}

module "sqs" {
  source      = "./modules/sqs"
  environment = var.environment
}

module "database" {
  source            = "./modules/database"
  environment       = var.environment
  subnet_ids        = module.networking.data_subnet_ids
  security_group_id = module.networking.rds_security_group_id
  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  db_name           = var.db_name
  db_username       = var.db_username
}

module "redis" {
  source            = "./modules/redis"
  environment       = var.environment
  subnet_ids        = module.networking.data_subnet_ids
  security_group_id = module.networking.redis_security_group_id
  node_type         = var.redis_node_type
}

module "alb" {
  source            = "./modules/alb"
  environment       = var.environment
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  security_group_id = module.networking.alb_security_group_id
}

module "ecs" {
  source                = "./modules/ecs"
  environment           = var.environment
  vpc_id                = module.networking.vpc_id
  subnet_ids            = module.networking.app_subnet_ids
  web_security_group_id = module.networking.web_security_group_id
  api_security_group_id = module.networking.api_security_group_id
  web_target_group_arn  = module.alb.web_target_group_arn
  api_target_group_arn  = module.alb.api_target_group_arn

  web_task_cpu          = var.web_task_cpu
  web_task_memory       = var.web_task_memory
  web_desired_count     = var.web_desired_count
  api_task_cpu          = var.api_task_cpu
  api_task_memory       = var.api_task_memory
  api_desired_count     = var.api_desired_count

  database_url          = "postgres://${var.db_username}@${module.database.endpoint}/${var.db_name}"
  redis_url             = "rediss://:${module.redis.auth_token}@${module.redis.primary_endpoint_address}:${module.redis.port}/0"
  uploads_bucket        = module.s3.uploads_bucket_name
  artifacts_bucket      = module.s3.artifacts_bucket_name
  sqs_queue_url         = module.sqs.media_jobs_queue_url
}

module "workers" {
  source            = "./modules/workers"
  environment       = var.environment
  vpc_id            = module.networking.vpc_id
  subnet_ids        = module.networking.worker_subnet_ids
  security_group_id = module.networking.workers_security_group_id
  sqs_queue_arn     = module.sqs.media_jobs_queue_arn
  sqs_queue_url     = module.sqs.media_jobs_queue_url
  uploads_bucket    = module.s3.uploads_bucket_name
  artifacts_bucket  = module.s3.artifacts_bucket_name
  min_instances     = var.worker_min_instances
  max_instances     = var.worker_max_instances
  instance_types    = var.worker_instance_types
  spot_percentage   = var.spot_percentage
}

module "cloudflare" {
  source       = "./modules/cloudflare"
  environment  = var.environment
  zone_id      = var.cloudflare_zone_id
  domain_name  = var.domain_name
  alb_dns_name = module.alb.alb_dns_name
}
