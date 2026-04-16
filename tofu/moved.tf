# ============================================================================
# State moves — renamed from infra_diagram to diagrams.
# The underlying Azure resources are also getting renamed (infra-diagram-rg ->
# diagrams-rg, infra-diagram-app -> diagrams-app, docs CNAME -> diagrams
# CNAME), which forces replace on each. The moved blocks keep the state
# graph coherent during the rename so OpenTofu plans a single replace per
# resource rather than remove+add of independent entities.
# ============================================================================

moved {
  from = azurerm_resource_group.infra_diagram
  to   = azurerm_resource_group.diagrams
}

moved {
  from = azurerm_static_web_app.infra_diagram
  to   = azurerm_static_web_app.diagrams
}

moved {
  from = azurerm_dns_cname_record.infra_diagram
  to   = azurerm_dns_cname_record.diagrams
}

moved {
  from = azurerm_static_web_app_custom_domain.infra_diagram
  to   = azurerm_static_web_app_custom_domain.diagrams
}
