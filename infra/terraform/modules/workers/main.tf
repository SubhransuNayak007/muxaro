# ==============================================================================
# MUXARO Media Transcoder Worker Fleet: Autoscaled EC2 Spot & NVMe Scratch
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

variable "security_group_id" {
  type = string
}

variable "sqs_queue_arn" {
  type = string
}

variable "sqs_queue_url" {
  type = string
}

variable "uploads_bucket" {
  type = string
}

variable "artifacts_bucket" {
  type = string
}

variable "min_instances" {
  type    = number
  default = 16
}

variable "max_instances" {
  type    = number
  default = 100
}

variable "instance_types" {
  type    = list(string)
  default = ["c6i.4xlarge", "c6a.4xlarge", "c7g.4xlarge", "c5.4xlarge"]
}

variable "spot_percentage" {
  type    = number
  default = 75
}

# ------------------------------------------------------------------------------
# IAM Role & Instance Profile for Transcoding Workers
# ------------------------------------------------------------------------------
resource "aws_iam_role" "worker_role" {
  name = "${var.environment}-muxaro-worker-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_policy" "worker_policy" {
  name = "${var.environment}-muxaro-worker-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = var.sqs_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::${var.uploads_bucket}/*", "arn:aws:s3:::${var.artifacts_bucket}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "cloudwatch:PutMetricData"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "worker_attach" {
  role       = aws_iam_role.worker_role.name
  policy_arn = aws_iam_policy.worker_policy.arn
}

resource "aws_iam_instance_profile" "worker_profile" {
  name = "${var.environment}-muxaro-worker-profile"
  role = aws_iam_role.worker_role.name
}

# ------------------------------------------------------------------------------
# Launch Template with NVMe Scratch Formatting & Docker Runtime
# ------------------------------------------------------------------------------
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_launch_template" "worker" {
  name_prefix   = "${var.environment}-muxaro-worker-"
  image_id      = data.aws_ami.amazon_linux_2023.id
  instance_type = var.instance_types[0]

  iam_instance_profile {
    name = aws_iam_instance_profile.worker_profile.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [var.security_group_id]
  }

  # Fast root volume for OS & container caching
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 80
      volume_type           = "gp3"
      delete_on_termination = true
      encrypted             = true
    }
  }

  user_data = base64encode(<<-EOF
              #!/bin/bash
              set -ex

              # Format and mount NVMe ephemeral scratch storage if present
              if ls /dev/nvme*n1 1> /dev/null 2>&1; then
                SCRATCH_DEV=$(ls /dev/nvme*n1 | grep -v nvme0n1 | head -n 1 || true)
                if [ -n "$SCRATCH_DEV" ]; then
                  mkfs.ext4 -F "$SCRATCH_DEV"
                  mkdir -p /tmp/muxaro-scratch
                  mount -o noatime,nodiratime "$SCRATCH_DEV" /tmp/muxaro-scratch
                  chmod 777 /tmp/muxaro-scratch
                fi
              fi

              # Install Docker and start worker daemon
              dnf install -y docker
              systemctl enable --now docker

              # Graceful termination handler for EC2 Spot Interruption Warnings
              cat << 'SHUTDOWN_SCRIPT' > /usr/local/bin/spot-listener.sh
              #!/bin/bash
              while true; do
                HTTP_CODE=$(curl -s -o /dev/null -w "%%{http_code}" http://169.254.169.254/latest/meta-data/spot/instance-action || true)
                if [ "$HTTP_CODE" -eq 200 ]; then
                  echo "[SRE] Spot interruption notice detected! Evacuating worker..."
                  docker kill --signal=SIGTERM muxaro-worker || true
                  sleep 85
                  exit 0
                fi
                sleep 5
              done
              SHUTDOWN_SCRIPT
              chmod +x /usr/local/bin/spot-listener.sh
              /usr/local/bin/spot-listener.sh &
              EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.environment}-muxaro-media-worker"
      Role = "Transcoder"
    }
  }
}

# ------------------------------------------------------------------------------
# Auto Scaling Group (75% Spot, 25% On-Demand Capacity)
# ------------------------------------------------------------------------------
resource "aws_autoscaling_group" "workers" {
  name_prefix         = "${var.environment}-muxaro-workers-asg-"
  vpc_zone_identifier = var.subnet_ids
  min_size            = var.min_instances
  max_size            = var.max_instances
  desired_capacity    = var.min_instances

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 4
      on_demand_percentage_above_base_capacity = 100 - var.spot_percentage
      spot_allocation_strategy                 = "price-capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.worker.id
        version            = "$Latest"
      }

      dynamic "override" {
        for_each = var.instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 80
      instance_warmup        = 60
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.environment}-muxaro-worker-node"
    propagate_at_launch = true
  }
}

# ------------------------------------------------------------------------------
# CloudWatch Scaling Policy: Scale based on SQS Queue Backlog
# ------------------------------------------------------------------------------
resource "aws_autoscaling_policy" "queue_scale_out" {
  name                   = "${var.environment}-worker-queue-scale-out"
  scaling_adjustment     = 4
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 45
  autoscaling_group_name = aws_autoscaling_group.workers.name
}

resource "aws_cloudwatch_metric_alarm" "sqs_high_backlog" {
  alarm_name          = "${var.environment}-sqs-high-queue-backlog"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 150 # When backlog exceeds 150 jobs, scale workers
  alarm_actions       = [aws_autoscaling_policy.queue_scale_out.arn]

  dimensions = {
    QueueName = "muxaro-${var.environment}-media-jobs"
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "autoscaling_group_name" {
  value = aws_autoscaling_group.workers.name
}
