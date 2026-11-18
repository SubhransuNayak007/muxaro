# ==============================================================================
# MUXARO Cache Module: AWS ElastiCache Redis 7 Replication Group
# ==============================================================================

variable "environment" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.m6g.large"
}

# ------------------------------------------------------------------------------
# Subnet & Parameter Groups
# ------------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.environment}-muxaro-redis-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.environment}-redis-subnet-group"
  }
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${var.environment}-muxaro-redis7-params"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }

  tags = {
    Name = "${var.environment}-redis7-params"
  }
}

resource "random_password" "redis_auth_token" {
  length  = 32
  special = false
}

# ------------------------------------------------------------------------------
# Redis Replication Group (Multi-AZ with Auto-Failover)
# ------------------------------------------------------------------------------
resource "aws_elasticache_replication_group" "cluster" {
  replication_group_id       = "${var.environment}-muxaro-redis"
  description                = "High-throughput cache and quota broker cluster for Muxaro"
  node_type                  = var.node_type
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.redis7.name
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [var.security_group_id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  num_cache_clusters         = 2 # 1 Primary + 1 Replica

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth_token.result

  snapshot_retention_limit = 5
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:03:30-sun:04:30"

  tags = {
    Name = "${var.environment}-muxaro-redis"
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "primary_endpoint_address" {
  value = aws_elasticache_replication_group.cluster.primary_endpoint_address
}

output "reader_endpoint_address" {
  value = aws_elasticache_replication_group.cluster.reader_endpoint_address
}

output "port" {
  value = 6379
}

output "auth_token" {
  value     = random_password.redis_auth_token.result
  sensitive = true
}
