resource "azurerm_resource_group" "infra_diagram" {
  name     = "infra-diagram-rg"
  location = var.location
}
