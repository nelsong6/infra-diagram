output "resource_group_name" {
  value       = azurerm_resource_group.diagrams.name
  description = "Name of the resource group"
}

output "static_web_app_name" {
  value       = azurerm_static_web_app.diagrams.name
  description = "Name of the Azure Static Web App"
}

output "static_web_app_default_hostname" {
  value       = azurerm_static_web_app.diagrams.default_host_name
  description = "Default hostname of the Static Web App"
}
