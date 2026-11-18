# ==============================================================================
# MUXARO Terraform Variables Definition
# ==============================================================================

variable "environment" {
  description = "Target deployment environment (production, staging, dev)"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Apex domain name for the platform (e.g., muxaro.com or muxaro.app)"
  type        = string
  default     = "muxaro.com"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone.DNS and Zone.WAF edit permissions"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for the target apex domain"
  type        = string
  default     = ""
}

# ------------------------------------------------------------------------------
# Networking Variables
# ------------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the dedicated VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to span for High Availability"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# ------------------------------------------------------------------------------
# Database & Cache Variables
# ------------------------------------------------------------------------------
variable "db_instance_class" {
  description = "Instance class for RDS PostgreSQL Multi-AZ primary"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB for PostgreSQL (gp3)"
  type        = number
  default     = 250
}

variable "db_name" {
  description = "PostgreSQL initial database name"
  type        = string
  default     = "muxaro_prod_db"
}

variable "db_username" {
  description = "Master username for PostgreSQL database"
  type        = string
  default     = "muxaro_admin"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.m6g.large"
}

# ------------------------------------------------------------------------------
# Compute & ECS Sizing Variables
# ------------------------------------------------------------------------------
variable "web_task_cpu" {
  description = "vCPU allocation for Next.js Web ECS task (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "web_task_memory" {
  description = "Memory allocation for Next.js Web ECS task (MB)"
  type        = number
  default     = 2048
}

variable "web_desired_count" {
  description = "Baseline task count for Next.js Web service"
  type        = number
  default     = 8
}

variable "api_task_cpu" {
  description = "vCPU allocation for Fastify API ECS task (2048 = 2 vCPU)"
  type        = number
  default     = 2048
}

variable "api_task_memory" {
  description = "Memory allocation for Fastify API ECS task (MB)"
  type        = number
  default     = 4096
}

variable "api_desired_count" {
  description = "Baseline task count for Fastify API service"
  type        = number
  default     = 10
}

# ------------------------------------------------------------------------------
# Media Transcoder Autoscaling Worker Fleet
# ------------------------------------------------------------------------------
variable "worker_min_instances" {
  description = "Minimum number of EC2 transcoding worker instances in ASG"
  type        = number
  default     = 16
}

variable "worker_max_instances" {
  description = "Maximum number of EC2 transcoding worker instances in ASG"
  type        = number
  default     = 100
}

variable "worker_instance_types" {
  description = "EC2 instance types for transcoding worker spot fleet"
  type        = list(string)
  default     = ["c6i.4xlarge", "c6a.4xlarge", "c7g.4xlarge", "c5.4xlarge"]
}

variable "spot_percentage" {
  description = "Percentage of transcoding worker instances running on Spot (0-100)"
  type        = number
  default     = 75
}
