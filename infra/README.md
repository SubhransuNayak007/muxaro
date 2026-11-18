# MUXARO Infrastructure & Deployment Guide

This directory houses containerization manifests, local and staging orchestration, database initialization scripts, health check utilities, and Terraform Infrastructure-as-Code (IaC) blueprints for Project MUXARO.

---

## 1. Directory Structure

```
infra/
├── .env.example              # Environment variables template for containers
├── docker-compose.yml        # Multi-service local/staging orchestration
├── Dockerfile.web            # Multi-stage production container for Next.js Web
├── Dockerfile.api            # Multi-stage production container for Fastify API
├── Dockerfile.media          # Hardened Debian container with FFmpeg & FFprobe
├── scripts/
│   ├── init-db.sql           # PostgreSQL 16 relational schema & seed migrations
│   ├── init-minio.sh         # MinIO S3 bucket provisioning & lifecycle rules
│   ├── run-migrations.sh     # Automated migration runner script
│   └── healthcheck.sh        # Multi-service HTTP & endpoint health validator
└── terraform/
    ├── versions.tf           # Terraform & AWS/Cloudflare provider constraints
    ├── variables.tf          # Configurable parameters (VPC, instance types, sizing)
    ├── terraform.tfvars.example # Production example variables
    ├── main.tf               # Root module orchestrating all child modules
    ├── outputs.tf            # ALB DNS, RDS endpoint, SQS URLs, S3 bucket names
    └── modules/
        ├── networking/       # Multi-AZ VPC (Public, App, Worker, Data subnets)
        ├── alb/              # Application Load Balancer with HTTPS redirect
        ├── ecs/              # ECS Fargate Cluster, Task Definitions & Services
        ├── workers/          # EC2 Spot Transcoder Autoscaling Group + NVMe mount
        ├── sqs/              # SQS Job Distribution Queue & Dead-Letter Queue
        ├── s3/               # Ephemeral Uploads & Processed Artifacts Buckets
        ├── database/         # RDS PostgreSQL 16 Multi-AZ Cluster
        ├── redis/            # ElastiCache Redis 7 Replication Group
        └── cloudflare/       # Edge DNS, WAF rate limiting, SSL Strict & Caching
```

---

## 2. Quickstart: Local Orchestration with Docker Compose

### Prerequisites
- Docker Engine 24.0+ and Docker Compose v2.20+
- At least 4 GB of available host RAM

### Step 1: Initialize Environment
```bash
cp infra/.env.example infra/.env
```

### Step 2: Start All Infrastructure Services
```bash
docker compose -f infra/docker-compose.yml up -d
```

This launches and health-checks 6 interconnected services:
1. `muxaro-postgres`: PostgreSQL 16 on port `5432` with auto-applied `init-db.sql`.
2. `muxaro-redis`: Redis 7 on port `6379` with `volatile-lru` memory cap.
3. `muxaro-minio`: MinIO S3 object store on ports `9000` (API) and `9001` (Web Console).
4. `muxaro-minio-init`: Automated bucket creator (`muxaro-uploads`, `muxaro-artifacts`, `muxaro-scratch`).
5. `muxaro-api`: Fastify API microservice on port `4000`.
6. `muxaro-media-worker`: FFmpeg/FFprobe media transcoder on port `5000`.
7. `muxaro-web`: Next.js 14 frontend web application on port `3000`.

### Step 3: Verify Service Health
Run the automated multi-service health checker:
```bash
sh infra/scripts/healthcheck.sh
```

---

## 3. Production Cloud Deployment with Terraform

The production infrastructure follows a defense-in-depth, zero-trust cloud architecture:
```
Cloudflare Edge (WAF/DDoS) ➔ AWS ALB ➔ ECS Fargate (Web & API) ➔ AWS SQS ➔ EC2 Spot Transcoders ➔ AWS S3
                                                 ├── RDS PostgreSQL 16 (Multi-AZ)
                                                 └── ElastiCache Redis 7 (Multi-AZ)
```

### Deployment Instructions:
1. Navigate to the terraform directory:
   ```bash
   cd infra/terraform
   ```
2. Create and configure variables:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Populate aws_region, domain_name, cloudflare_api_token, cloudflare_zone_id
   ```
3. Initialize Terraform providers and backend:
   ```bash
   terraform init
   ```
4. Review the infrastructure execution plan:
   ```bash
   terraform plan -out=tfplan
   ```
5. Apply the plan:
   ```bash
   terraform apply tfplan
   ```

---

## 4. Capacity Engineering & Sizing Reference

For the comprehensive mathematical modeling of **100,000 Concurrent Active Users (CCU)**, including API RPS, Little's Law queue backlog calculations, EC2 Spot worker fleet sizing, and monthly cost optimization, refer to:
[docs/CAPACITY_PLAN.md](file:///d:/yt%20doenlord/docs/CAPACITY_PLAN.md).
