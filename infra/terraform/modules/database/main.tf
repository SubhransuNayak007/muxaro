# ==============================================================================
# MUXARO Database Module: High-Availability PostgreSQL 16 Multi-AZ
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

variable "instance_class" {
  type    = string
  default = "db.r6g.xlarge"
}

variable "allocated_storage" {
  type    = number
  default = 250
}

variable "db_name" {
  type    = string
  default = "muxaro_prod_db"
}

variable "db_username" {
  type    = string
  default = "muxaro_admin"
}

# ------------------------------------------------------------------------------
# Subnet & Parameter Groups
# ------------------------------------------------------------------------------
resource "aws_db_subnet_group" "rds" {
  name       = "${var.environment}-muxaro-db-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "${var.environment}-db-subnet-group"
  }
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${var.environment}-muxaro-pg16-params"
  family = "postgres16"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "250" # Log queries taking longer than 250ms for performance audits
  }

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = {
    Name = "${var.environment}-pg16-params"
  }
}

# ------------------------------------------------------------------------------
# Master Password & Secrets Manager
# ------------------------------------------------------------------------------
resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_secret" {
  name                    = "${var.environment}-muxaro-db-credentials"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_secret_val" {
  secret_id = aws_secretsmanager_secret.db_secret.id
  secret_string = jsonencode({
    engine   = "postgres"
    host     = aws_db_instance.primary.address
    port     = aws_db_instance.primary.port
    username = var.db_username
    password = random_password.db_password.result
    database = var.db_name
  })
}

# ------------------------------------------------------------------------------
# Multi-AZ Primary RDS Instance
# ------------------------------------------------------------------------------
resource "aws_db_instance" "primary" {
  identifier                  = "${var.environment}-muxaro-postgres"
  engine                      = "postgres"
  engine_version              = "16.2"
  instance_class              = var.instance_class
  allocated_storage           = var.allocated_storage
  max_allocated_storage       = 1000 # Auto-scale up to 1 TB
  storage_type                = "gp3"
  multi_az                    = true
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.rds.name
  vpc_security_group_ids      = [var.security_group_id]
  parameter_group_name        = aws_db_parameter_group.pg16.name

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  backup_retention_period   = 14
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:30-sun:05:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot     = true
  deletion_protection       = var.environment == "production" ? true : false
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "${var.environment}-muxaro-postgres-final-snapshot"

  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = {
    Name = "${var.environment}-muxaro-postgres"
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "endpoint" {
  value = aws_db_instance.primary.endpoint
}

output "address" {
  value = aws_db_instance.primary.address
}

output "port" {
  value = aws_db_instance.primary.port
}

output "database_name" {
  value = var.db_name
}

output "secret_arn" {
  value = aws_secretsmanager_secret.db_secret.arn
}
