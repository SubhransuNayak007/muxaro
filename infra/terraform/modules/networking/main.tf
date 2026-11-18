# ==============================================================================
# MUXARO Networking Module: Multi-AZ High Availability VPC & Security Groups
# ==============================================================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.environment}-muxaro-vpc"
  }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.environment}-muxaro-igw"
  }
}

# ------------------------------------------------------------------------------
# Subnets (3 Availability Zones for High Availability)
# ------------------------------------------------------------------------------
resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.environment}-public-${var.availability_zones[count.index]}"
    Tier = "Public"
  }
}

resource "aws_subnet" "app" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 3)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.environment}-app-${var.availability_zones[count.index]}"
    Tier = "PrivateApp"
  }
}

resource "aws_subnet" "workers" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 6)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.environment}-workers-${var.availability_zones[count.index]}"
    Tier = "PrivateWorkers"
  }
}

resource "aws_subnet" "data" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 9)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.environment}-data-${var.availability_zones[count.index]}"
    Tier = "PrivateData"
  }
}

# ------------------------------------------------------------------------------
# NAT Gateways & Routing (One per AZ for resilience)
# ------------------------------------------------------------------------------
resource "aws_eip" "nat" {
  count  = length(var.availability_zones)
  domain = "vpc"

  tags = {
    Name = "${var.environment}-nat-eip-${var.availability_zones[count.index]}"
  }
}

resource "aws_nat_gateway" "nat" {
  count         = length(var.availability_zones)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${var.environment}-nat-gw-${var.availability_zones[count.index]}"
  }

  depends_on = [aws_internet_gateway.gw]
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }

  tags = {
    Name = "${var.environment}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private_app" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat[count.index].id
  }

  tags = {
    Name = "${var.environment}-private-app-rt-${var.availability_zones[count.index]}"
  }
}

resource "aws_route_table_association" "app" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.private_app[count.index].id
}

resource "aws_route_table_association" "workers" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.workers[count.index].id
  route_table_id = aws_route_table.private_app[count.index].id
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.environment}-data-rt"
  }
}

resource "aws_route_table_association" "data" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# ------------------------------------------------------------------------------
# Security Groups: Tiered Defense-in-Depth
# ------------------------------------------------------------------------------

# ALB Security Group
resource "aws_security_group" "alb" {
  name        = "${var.environment}-muxaro-alb-sg"
  description = "Controls ingress traffic to Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP Ingress (Redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS Ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-alb-sg"
  }
}

# Web Service Security Group
resource "aws_security_group" "web" {
  name        = "${var.environment}-muxaro-web-sg"
  description = "Allows ingress from ALB to Next.js Web tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Inbound from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-web-sg"
  }
}

# API Service Security Group
resource "aws_security_group" "api" {
  name        = "${var.environment}-muxaro-api-sg"
  description = "Allows ingress from ALB and Web service to Fastify API tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Inbound from ALB"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Inbound from Web SSR"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-api-sg"
  }
}

# Media Transcoding Worker Security Group
resource "aws_security_group" "workers" {
  name        = "${var.environment}-muxaro-workers-sg"
  description = "Transcoding worker instances security group (no public ingress)"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Internal control port from API"
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    description = "Egress to SQS, S3, and package repositories via NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-workers-sg"
  }
}

# Database Security Group (PostgreSQL)
resource "aws_security_group" "rds" {
  name        = "${var.environment}-muxaro-rds-sg"
  description = "Restricts PostgreSQL access strictly to API and Worker tiers"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from API tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.workers.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-rds-sg"
  }
}

# Redis Security Group
resource "aws_security_group" "redis" {
  name        = "${var.environment}-muxaro-redis-sg"
  description = "Restricts Redis access strictly to API and Worker tiers"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from API and Worker tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.workers.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-redis-sg"
  }
}
