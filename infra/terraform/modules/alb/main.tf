# ==============================================================================
# MUXARO Application Load Balancer (ALB) & Routing Module
# ==============================================================================

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "certificate_arn" {
  type        = string
  description = "ACM Certificate ARN for HTTPS listener (optional, fallback to self-signed or HTTP in dev)"
  default     = ""
}

# ------------------------------------------------------------------------------
# Load Balancer Instance
# ------------------------------------------------------------------------------
resource "aws_lb" "main" {
  name               = "${var.environment}-muxaro-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "production" ? true : false
  drop_invalid_header_fields = true

  tags = {
    Name = "${var.environment}-muxaro-alb"
  }
}

# ------------------------------------------------------------------------------
# Target Groups: Web (Next.js) & API (Fastify)
# ------------------------------------------------------------------------------
resource "aws_lb_target_group" "web" {
  name                 = "${var.environment}-muxaro-web-tg"
  port                 = 3000
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip" # ECS Fargate uses awsvpc mode
  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/"
    port                = "3000"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.environment}-web-tg"
  }
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.environment}-muxaro-api-tg"
  port                 = 4000
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = 15

  health_check {
    enabled             = true
    path                = "/health"
    port                = "4000"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 10
    timeout             = 4
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.environment}-api-tg"
  }
}

# ------------------------------------------------------------------------------
# Listeners & Routing Rules
# ------------------------------------------------------------------------------

# HTTP Port 80 Listener (Always redirects to HTTPS in production, or forwards directly if no cert)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.certificate_arn != "" ? "redirect" : "forward"
    target_group_arn = var.certificate_arn == "" ? aws_lb_target_group.web.arn : null

    dynamic "redirect" {
      for_each = var.certificate_arn != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

# HTTPS Port 443 Listener
resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# Path-based routing rule: /api/* -> Fastify API target group
resource "aws_lb_listener_rule" "api_routing_https" {
  count        = var.certificate_arn != "" ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

resource "aws_lb_listener_rule" "api_routing_http" {
  count        = var.certificate_arn == "" ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "web_target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "api_target_group_arn" {
  value = aws_lb_target_group.api.arn
}
