# Azure Static Web App for the React frontend. Free tier — deployment is handled
# by GitHub Actions, not by SWA's built-in CI.
resource "azurerm_static_web_app" "infra_diagram" {
  name                = "infra-diagram-app"
  resource_group_name = azurerm_resource_group.infra_diagram.name
  location            = azurerm_resource_group.infra_diagram.location
  sku_tier            = "Free"
  sku_size            = "Free"
  lifecycle {
    ignore_changes = [
      repository_url,
      repository_branch
    ]
  }
}

locals {
  front_app_dns_name = "docs"
}

resource "azurerm_dns_cname_record" "infra_diagram" {
  name                = local.front_app_dns_name
  zone_name           = local.infra.dns_zone_name
  resource_group_name = local.infra.resource_group_name
  ttl                 = 3600
  record              = azurerm_static_web_app.infra_diagram.default_host_name
}

resource "azurerm_static_web_app_custom_domain" "infra_diagram" {
  static_web_app_id = azurerm_static_web_app.infra_diagram.id
  domain_name       = "${local.front_app_dns_name}.${local.infra.dns_zone_name}"
  validation_type   = "cname-delegation"
  depends_on        = [azurerm_dns_cname_record.infra_diagram]
}
