# challenge-nodejs-2025

# 🧪 OlaClick Backend Challenge - NestJS Edition

## 🎯 Objetivo

Diseñar e implementar una API RESTful que gestione órdenes de un restaurante utilizando el stack:

- **Node.js + TypeScript**
- **NestJS (arquitectura modular y principios SOLID)**
- **Sequelize (ORM)**
- **PostgreSQL** como base de datos
- **Redis** para cache
- **Docker** para contenerización

---

## 📌 Requerimientos Funcionales

### 1. Listar todas las órdenes
- Endpoint: `GET /orders`
- Devuelve todas las órdenes con estado diferente de `delivered`.
- Resultado cacheado en **Redis** por 30 segundos.

### 2. Crear una nueva orden
- Endpoint: `POST /orders`
- Inserta una nueva orden en estado `initiated`.
- Estructura esperada:
  ```json
  {
    "clientName": "Ana López",
    "items": [
      { "description": "Ceviche", "quantity": 2, "unitPrice": 50 },
      { "description": "Chicha morada", "quantity": 1, "unitPrice": 10 }
    ]
  }

### 3. Avanzar estado de una orden
Endpoint: `POST /orders/:id/advance`

Progreso del estado:

`initiated → sent → delivered`

Si llega a `delivered`, debe eliminarse de la base de datos y del caché.

### 4. Ver detalle de una orden
Endpoint: `GET /orders/:id`

Muestra la orden con todos sus detalles e items.

### 🧱 Consideraciones Técnicas
- Estructura modular con NestJS (modules, controllers, services, repositories)
- Uso de principios SOLID
- ORM: Sequelize con PostgreSQL
- Uso de DTOs y Pipes para validaciones
- Integración con Redis para cache de consultas
- Manejo de errores estructurado (filtros de excepción, status codes)
- Contenerización con Docker
- Al menos una prueba automatizada con Jest (e2e o unit test)

### 📦 Estructura sugerida
```
src/
├── orders/
│   ├── dto/
│   ├── entities/
│   ├── orders.controller.ts
│   ├── orders.service.ts
│   ├── orders.module.ts
├── app.module.ts
├── main.ts
```

### 📘 Extras valorados
- Uso de interceptors para logging o transformación de respuestas
- Jobs con `@nestjs/schedule` para depuración de órdenes antiguas (bonus)
- Uso de ConfigModule para manejar variables de entorno

### 🚀 Entrega
1. Haz un fork de este repositorio (o crea uno nuevo).
2. Implementa tu solución y enviala con un push o enviandonos el enlace del repositorio publico.
3. Incluye un README.md con:
- Instrucciones para correr con docker o docker-compose
- Cómo probar endpoints (Postman, Swagger, cURL)
- Consideraciones técnicas

❓ Preguntas adicionales 
- ¿Cómo desacoplarías la lógica de negocio del framework NestJS?
- ¿Cómo escalarías esta API para soportar miles de órdenes concurrentes?
- ¿Qué ventajas ofrece Redis en este caso y qué alternativas considerarías?

¡Buena suerte y disfruta el reto! 🚀

## Build and run with docker
### Run this inside the project's root folder

```bash
docker-compose up -d
```

## How to check the API with swagger
### After up and run docker use this url that sposes the swagger docs

```bash
http://localhost:3100/api/docs
```

## Technical considerations
You need to have the last version of docker in your machine to build the project 


- ¿Cómo desacoplarías la lógica de negocio del framework NestJS?

Ya de por si NestJS ayuda a implementar una lógica desacoplada de la forma que se esperaría de un projecto hecho con Clean Architecture.

 Pero se podria crear la lógica en otra carpeta o library de npm y luego injectarla en los "services" de NestJS mediante injección de dependencias, esta logica serían "caso de uso" y cada método del service llamaría al caso de uso con la lógica que lo resuelve.
 Con lo cual si se dejara de usar Nest se podria reutilizar con otro framwork de Node como usar Express directamente.

- ¿Cómo escalarías esta API para soportar miles de órdenes concurrentes?

Lo que haria es que segun la demanda, que autoescale y se levanten mas intancias del servidores node, y que haya un load balancer en el frente balanciado las peticiones entre instancias y tambian autoescalar la cantidad de intancias de redis, tal vez seria necesario hacer un shading de la PostgreSQL 


- ¿Qué ventajas ofrece Redis en este caso y qué alternativas considerarías?

Es una cache en memoria y se espera que se mas rápida para busquedas de tipo key/value que su contraparte SQL (PostgreSQL o MySQL)