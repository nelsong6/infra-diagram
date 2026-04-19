resource "azurerm_resource_group" "diagrams" {
  name     = "diagrams-rg"
  location = var.location
}

# App identity — kept for consistency with other repos even though this
# app's hostname is set in k8s manifests now that it runs on AKS.
locals {
  front_app_dns_name = "diagrams"
}
