provider "azurerm" {
  features {}
}

variable "prefix" {
  type    = string
  default = "gaia"
}

variable "location" {
  type    = string
  default = "West Europe"
}

variable "aks_node_count" {
  type    = number
  default = 2
}

resource "azurerm_resource_group" "main" {
  name     = "${var.prefix}-rg"
  location = var.location
}

resource "azurerm_kubernetes_cluster" "gaia" {
  name                = "${var.prefix}-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "${var.prefix}-k8s"

  default_node_pool {
    name       = "default"
    node_count = var.aks_node_count
    vm_size    = "Standard_B4ms"
  }

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_postgresql_flexible_server" "gaia" {
  name                = "${var.prefix}-pg"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  version             = "16"
  administrator_login = "gaia"
}

output "kube_config" {
  value     = azurerm_kubernetes_cluster.gaia.kube_config_raw
  sensitive = true
}

output "aks_name" {
  value = azurerm_kubernetes_cluster.gaia.name
}