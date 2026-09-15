{{- define "gaia.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "gaia.selectorLabels" -}}
app.kubernetes.io/name: {{ include "gaia.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "gaia.ingestion.selectorLabels" -}}
app.kubernetes.io/name: ingestion
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "gaia.scenario.selectorLabels" -}}
app.kubernetes.io/name: scenario
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "gaia.ai.selectorLabels" -}}
app.kubernetes.io/name: ai-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}