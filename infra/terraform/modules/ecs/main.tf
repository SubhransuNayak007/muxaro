# ==============================================================================
# MUXARO ECS Fargate Compute Module: Web (Next.js) & API (Fastify)
# ==============================================================================

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "web_security_group_id" {
  type = string
}

variable "api_security_group_id" {
  type = string
}

variable "web_target_group_arn" {
  type = string
}

variable "api_target_group_arn" {
  type = string
}

variable "web_task_cpu" {
  type    = number
  default = 1024
}

variable "web_task_memory" {
  type    = number
  default = 2048
}

variable "web_desired_count" {
  type    = number
  default = 8
}

variable "api_task_cpu" {
  type    = number
  default = 2048
}

variable "api_task_memory" {
  type    = number
  default = 4096
}

variable "api_desired_count" {
  type    = number
  default = 10
}

variable "web_image" {
  type    = string
  default = "muxaro/web:latest"
}

variable "api_image" {
  type    = string
  default = "muxaro/api:latest"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type      = string
  sensitive = true
}

variable "uploads_bucket" {
  type = string
}

variable "artifacts_bucket" {
  type = string
}

variable "sqs_queue_url" {
  type = string
}

# ------------------------------------------------------------------------------
# ECS Cluster
# ------------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "${var.environment}-muxaro-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.environment}-muxaro-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "providers" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 2
  }

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 3 # Offload 75% of web/api burst to Fargate Spot
  }
}

# ------------------------------------------------------------------------------
# IAM Roles & CloudWatch Logs
# ------------------------------------------------------------------------------
resource "aws_iam_role" "execution_role" {
  name = "${var.environment}-muxaro-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution_policy" {
  role       = aws_iam_role.execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task_role" {
  name = "${var.environment}-muxaro-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_policy" "task_policy" {
  name = "${var.environment}-muxaro-ecs-task-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = ["arn:aws:s3:::${var.uploads_bucket}*", "arn:aws:s3:::${var.artifacts_bucket}*"]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_policy_attachment" {
  role       = aws_iam_role.task_role.name
  policy_arn = aws_iam_policy.task_policy.arn
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.environment}-muxaro-web"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-muxaro-api"
  retention_in_days = 7
}

# ------------------------------------------------------------------------------
# Web Task Definition & Service (Next.js)
# ------------------------------------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.environment}-muxaro-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_task_cpu
  memory                   = var.web_task_memory
  execution_role_arn       = aws_iam_role.execution_role.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = var.web_image
    essential = true
    portMappings = [{
      containerPort = 3000
      hostPort      = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "HOSTNAME", value = "0.0.0.0" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${var.environment}-muxaro-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.web_security_group_id]
  }

  load_balancer {
    target_group_arn = var.web_target_group_arn
    container_name   = "web"
    container_port   = 3000
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ------------------------------------------------------------------------------
# API Task Definition & Service (Fastify)
# ------------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-muxaro-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_task_cpu
  memory                   = var.api_task_memory
  execution_role_arn       = aws_iam_role.execution_role.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true
    portMappings = [{
      containerPort = 4000
      hostPort      = 4000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "4000" },
      { name = "HOST", value = "0.0.0.0" },
      { name = "DATABASE_URL", value = var.database_url },
      { name = "REDIS_URL", value = var.redis_url },
      { name = "S3_BUCKET_UPLOADS", value = var.uploads_bucket },
      { name = "S3_BUCKET_ARTIFACTS", value = var.artifacts_bucket },
      { name = "SQS_QUEUE_URL", value = var.sqs_queue_url }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${var.environment}-muxaro-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.api_security_group_id]
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = 4000
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ------------------------------------------------------------------------------
# Autoscaling (Target Tracking at 70% CPU)
# ------------------------------------------------------------------------------
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 30
  min_capacity       = var.api_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.environment}-api-cpu-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 45
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}
