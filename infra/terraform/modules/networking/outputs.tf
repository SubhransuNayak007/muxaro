output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  value = aws_subnet.app[*].id
}

output "worker_subnet_ids" {
  value = aws_subnet.workers[*].id
}

output "data_subnet_ids" {
  value = aws_subnet.data[*].id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "web_security_group_id" {
  value = aws_security_group.web.id
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "workers_security_group_id" {
  value = aws_security_group.workers.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}
