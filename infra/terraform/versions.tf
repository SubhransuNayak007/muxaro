# ==============================================================================
# MUXARO Terraform Provider & Version Constraints
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Production state backend template (AWS S3 + DynamoDB state locking)
  # backend "s3" {
  #   bucket         = "muxaro-terraform-state-prod"
  #   key            = "platform/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "muxaro-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "MUXARO"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "https://github.com/muxaro/platform"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
