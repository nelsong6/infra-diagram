# References to shared infrastructure provisioned by infra-bootstrap.
locals {
  infra = {
    resource_group_name = "infra"
    dns_zone_name       = "romaine.life"
  }
}
