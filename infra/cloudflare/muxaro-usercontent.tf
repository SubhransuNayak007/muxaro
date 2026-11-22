# ==============================================================================
# MUXARO Edge Download Domain Isolation (muxaro-usercontent.com)
#
# Threat Model:
# - User-uploaded or transcoded files might contain malicious polyglot SVG/HTML payloads.
# - Serving files from the primary application domain (muxaro.com / muxaro.app) allows
#   session stealing, cookie access, and stored XSS within the app origin.
# - Resolution: Isolate all downloads to a separate apex domain (muxaro-usercontent.com)
#   with mandatory browser security headers applied at the Cloudflare Edge.
# ==============================================================================

variable "usercontent_zone_id" {
  type        = string
  description = "Cloudflare Zone ID for muxaro-usercontent.com"
  default     = ""
}

# ------------------------------------------------------------------------------
# DNS Records for Edge Download Worker
# ------------------------------------------------------------------------------
resource "cloudflare_record" "usercontent_download" {
  count   = var.usercontent_zone_id != "" ? 1 : 0
  zone_id = var.usercontent_zone_id
  name    = "download"
  value   = "muxaro-download-worker.workers.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

resource "cloudflare_record" "usercontent_wildcard" {
  count   = var.usercontent_zone_id != "" ? 1 : 0
  zone_id = var.usercontent_zone_id
  name    = "*"
  value   = "muxaro-download-worker.workers.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# ------------------------------------------------------------------------------
# HTTP Response Header Modification Rules (Cloudflare Transform Rules)
# Mandates Anti-XSS and Sandbox isolation on edge responses
# ------------------------------------------------------------------------------
resource "cloudflare_ruleset" "usercontent_anti_xss_headers" {
  count       = var.usercontent_zone_id != "" ? 1 : 0
  zone_id     = var.usercontent_zone_id
  name        = "Muxaro User Content Anti-XSS Header Modification"
  description = "Forces download attachment, octet-stream, nosniff, CSP sandbox, and DENY framing"
  kind        = "zone"
  phase       = "http_response_headers_transform"

  rules {
    action = "rewrite"
    action_parameters {
      headers {
        name      = "Content-Type"
        operation = "set"
        value     = "application/octet-stream"
      }
      headers {
        name      = "Content-Disposition"
        operation = "set"
        value     = "attachment"
      }
      headers {
        name      = "X-Content-Type-Options"
        operation = "set"
        value     = "nosniff"
      }
      headers {
        name      = "Content-Security-Policy"
        operation = "set"
        value     = "sandbox; default-src 'none'"
      }
      headers {
        name      = "X-Frame-Options"
        operation = "set"
        value     = "DENY"
      }
      headers {
        name      = "Referrer-Policy"
        operation = "set"
        value     = "no-referrer"
      }
      headers {
        name      = "Cross-Origin-Resource-Policy"
        operation = "set"
        value     = "cross-origin"
      }
    }
    expression  = "(http.host eq \"muxaro-usercontent.com\" or http.host matches r\".*\\.muxaro-usercontent\\.com\")"
    description = "Enforce anti-XSS header hardening on all download endpoints"
    enabled     = true
  }
}
