XINYUAN IMPORT — CATÁLOGO + SISTEMA DE GESTIÓN
================================================

REQUISITOS
- Node.js 20 o superior
- npm

INSTALACIÓN LOCAL
1. Descomprime la carpeta.
2. Abre una terminal dentro de la carpeta del proyecto.
3. Ejecuta: npm install
4. Copia .env.example y crea un archivo llamado .env.
5. En .env cambia SESSION_SECRET por una clave larga y aleatoria.
6. En .env configura SESSION_SECRET con una clave aleatoria larga.
7. Guarda el archivo .env en la misma carpeta que server.js y reinicia el servidor si modificas la clave.
8. Ejecuta: npm start
9. Abre: http://localhost:3000
10. Entra a “Ingresar”. La primera vez aparecerá el formulario para crear la cuenta OWNER.
11. Crea la cuenta OWNER usando únicamente un nombre de usuario y una contraseña (mínimo 10 caracteres).

IMPORTANTE: no existe una cuenta OWNER predeterminada. La primera cuenta OWNER se crea una sola vez. Por seguridad, realiza este primer registro antes de publicar o compartir el servidor: mientras no exista un OWNER, cualquier persona que pueda acceder al panel podría intentar crear esa cuenta.

ACCESOS
- OWNER: acceso total, creación de administradores/vendedores y permisos individuales.
- ADMINISTRADOR: panel de ventas, inventario, caja, reportes y rendimiento según permisos habilitados.
- VENDEDOR: apertura/cierre de su caja, registro de ventas, consulta de stock y sus propias ventas según permisos.

MÓDULOS IMPLEMENTADOS
- Autenticación con contraseña cifrada, sesiones persistentes en SQLite y límite de intentos de acceso.
- Usuarios, roles y permisos individuales por apartado.
- Dashboard con ventas del día/mes, stock y ranking de vendedores.
- Registro de ventas con varios productos, validación de stock y métodos de pago.
- Descuento de inventario y trazabilidad de movimientos.
- Apertura/cierre de caja, ingresos, egresos, saldo esperado y diferencia de cierre.
- Historial de ventas, anulación con reposición de stock y reverso de efectivo cuando la caja sigue abierta.
- Reportes, exportación CSV y registro de actividad.
- Catálogo público y detalle de producto alimentados desde la base de datos.
- Los pedidos del catálogo público siguen redirigiendo a WhatsApp.

BASE DE DATOS
SQLite se crea automáticamente en data/business.sqlite. Las sesiones se guardan en data/sessions.sqlite. Los datos reales no se incluyen en el ZIP ni deben subirse a un repositorio público.

SEGURIDAD Y PRODUCCIÓN
- Para producción usa HTTPS, COOKIE_SECURE=true y un SESSION_SECRET fuerte.
- Configura copias de seguridad periódicas de la carpeta data.
- No publiques .env ni los archivos SQLite.
- El almacenamiento de sesiones SQLite está preparado para un despliegue pequeño/mediano; para una operación de alta concurrencia conviene migrar a PostgreSQL y un almacén de sesiones dedicado.
- Los importes de venta se calculan con los precios guardados en el servidor; no se confía en el total enviado por el navegador.

CATÁLOGO Y PRODUCTOS
Los 19 productos que ya existían en app.js se cargan como inventario inicial la primera vez que se crea la base de datos. Los cambios desde Inventario se reflejan en el catálogo público. Las imágenes existentes permanecen dentro de img/.

WHATSAPP
El número continúa configurado en app.js mediante WHATSAPP_NUMBER.
