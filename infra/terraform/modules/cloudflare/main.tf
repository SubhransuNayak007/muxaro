# ==============================================================================
# MUXARO Cloudflare Module: Edge Security, WAF, DNS & Static Caching
# ==============================================================================

variable "environment" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "alb_dns_name" {
  type = string
}

# ------------------------------------------------------------------------------
# DNS CNAME Records (Proxied via Cloudflare Edge)
# ------------------------------------------------------------------------------
resource "cloudflare_record" "apex" {
  count   = var.zone_id != "" ? 1 : 0
  zone_id = var.zone_id
  name    = "@"
  value   = var.alb_dns_name
  type    = "CNAME"
  proxied = true
  ttl     = 1 # Automatic
}

resource "cloudflare_record" "www" {
  count   = var.zone_id != "" ? 1 : 0
  zone_id = var.zone_id
  name    = "www"
  value   = var.alb_dns_name
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# ------------------------------------------------------------------------------
# Zone Settings & SSL/TLS
# ------------------------------------------------------------------------------
resource "cloudflare_zone_settings_override" "settings" {
  count   = var.zone_id != "" ? 1 : 0
  zone_id = var.zone_id

  settings {
    ssl                      = "strict"
    always_use_https         = "on"
    min_tls_version          = "1.2"
    brotli                   = "on"
    early_hints              = "on"
    http2                    = "on"
    http3                    = "on"
    security_header {
      enabled            = true
      preload            = true
      max_age            = 31536000
      include_subdomains = true
      nosniff            = true
    }
  }
}

# ------------------------------------------------------------------------------
# Rate Limiting & Abuse Defense
# ------------------------------------------------------------------------------
resource "cloudflare_rate_limit" "api_protection" {
  count   = var.zone_id != "" ? 1 : 0
  zone_id = var.zone_id
  threshold = 120
  period    = 10

  match {
    request {
      url_pattern = "${var.domain_name}/api/*"
      schemes     = ["HTTP", "HTTPS"]
      methods     = ["GET", "POST", "PUT", "DELETE"]
    }
  }

  action {
    mode    = "simulate" # Switch to "block" or "challenge" in production
    timeout = 60
    response {
      content_type = "application/json"
      body         = "{\"success\":false,\"error\":{\"code\":\"RATE_LIMIT_EXCEEDED\",\"message\":\"Too many requests. Please throttle your client.\"}}"
    }
  }

  disabled    = false
  description = "Throttles abusive client polling and brute-force submissions"
}
