# Conectar ReUI en Claude Code

Los archivos de esta carpeta son ejemplos; no modifican ninguna configuración del equipo y no contienen credenciales.

**Preferir OAuth para uso interactivo.** Incorporar la entrada de `mcp.oauth.example.json` a la configuración MCP del proyecto en Claude Code, conservando otras conexiones existentes. Autenticar la cuenta desde el flujo de Claude Code. No añadir el sufijo `/mcp` a la URL: el endpoint documentado es `https://mcp.reui.io`. [Documentación oficial de ReUI](https://reui.io/docs/mcp).

Para un entorno que requiera un token personal, usar **en su lugar** `mcp.token.example.json` y proporcionar `REUI_MCP_TOKEN` al proceso de Claude Code mediante un entorno seguro. La expansión `${VARIABLE}` en los headers está documentada por [Claude Code](https://code.claude.com/docs/en/mcp). No pegar el valor en el chat, archivos versionados, logs o instrucciones. Una variable escrita solamente en `.env.local` de la aplicación no queda automáticamente disponible al proceso de Claude Code.

Después de conectar, pedir `get_project_context` y verificar el acceso de esa cuenta. En esta investigación el MCP de Codex informó acceso Ultimate; eso no acredita la autenticación de otra instalación.

**La licencia del registry es otra configuración.** Si se instalan bloques premium mediante shadcn, seguir el documento 04 y usar `REUI_LICENSE_KEY` en el entorno privado de la aplicación. No sustituir automáticamente esa clave por el token MCP. [Registry oficial](https://reui.io/docs/registry).

No hace falta introducir claves de Meta, bancos, Stripe, Composio ni otros proveedores para esta demo: los adaptadores externos están simulados. PostgreSQL y el almacenamiento privado sí necesitan una configuración real del entorno donde se ejecute la aplicación; Claude debe producir `.env.example` con las variables exactas de su implementación y sin valores secretos.
