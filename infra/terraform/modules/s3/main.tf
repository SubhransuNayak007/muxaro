# ==============================================================================
# MUXARO S3 Object Storage Module: Ephemeral Uploads & Processed Artifacts
# ==============================================================================

variable "environment" {
  type = string
}

# ------------------------------------------------------------------------------
# 1. Raw Uploads Bucket (Ephemeral 2-Hour Scratch Buffer)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "uploads" {
  bucket        = "muxaro-${var.environment}-uploads"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "auto-expire-raw-uploads-2h"
    status = "Enabled"

    expiration {
      days = 1 # AWS S3 minimum lifecycle expiration is 1 day; custom worker job cleans within 2h
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

# ------------------------------------------------------------------------------
# 2. Processed Artifacts Bucket (24-Hour Ephemeral Retention)
# ------------------------------------------------------------------------------
resource "aws_s3_bucket" "artifacts" {
  bucket        = "muxaro-${var.environment}-artifacts"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "auto-expire-artifacts-24h"
    status = "Enabled"

    expiration {
      days = 1 # Enforces 24-hour cleanup
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 86400
  }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.artifacts.id
}

output "artifacts_bucket_arn" {
  value = aws_s3_bucket.artifacts.arn
}
