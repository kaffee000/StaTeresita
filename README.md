# Santa Teresita

Aplicación móvil para apoyar la gestión de Santa Teresita: clientes, ventas, pagos, inventario, rutas.

## Tecnologías

- **Expo SDK 58** y **React Native** para ejecutar la aplicación en Android, iOS y web.
- **TypeScript** para el desarrollo.
- **Supabase** como backend: base de datos PostgreSQL alojada en la nube, autenticación y API para acceder a los datos.

## Requisitos

- Node.js y npm.
- Un proyecto de Supabase configurado con el esquema que utiliza la aplicación.
- Para probar en un dispositivo físico, la aplicación Expo Go o un development build compatible con la versión de Expo del proyecto.

## Instalación y ejecución

Desde la carpeta del proyecto:

```bash
npm install
npx expo start
```

### Configuración de conexión

La URL de Supabase y una clave publica están actualmente configuradas en `src/lib/supabase.ts` para este proyecto de prueba. Si conectas otro proyecto, actualiza esos valores. Para un despliegue, es preferible mover la configuración a variables de entorno y nunca incluir una clave secreta o `service_role` en la aplicación cliente.