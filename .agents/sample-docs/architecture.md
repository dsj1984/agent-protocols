# System Architecture

This document describes the high-level architecture of Project Acme, a multi-tier web application designed for scalability and performance.

## 1. Overview

Project Acme follows a standard modern tech stack separated into three primary layers:
- **Frontend Layer:** React.js / Vite web application and React Native mobile application.
- **Backend API Layer:** Express.js REST API with WebSocket support.
- **Data Layer:** PostgreSQL relational database and Redis for caching/PubSub.

## 2. Component Diagram

```mermaid
graph TD
    User([User Device]) --> CDN[Cloudflare CDN]
    CDN --> WebApp[React Web App]
    CDN --> MobileApp[React Native Mobile]
    
    WebApp --> APIGateway[NGINX API Gateway]
    MobileApp --> APIGateway
    
    APIGateway --> NodeAPI[Auth Service (Node.js)]
    APIGateway --> ContentAPI[Content Service (Node.js)]
    APIGateway --> WSServer[WebSocket Server]
    
    NodeAPI --> PostgresDB[(PostgreSQL)]
    ContentAPI --> PostgresDB
    
    WSServer -.-> RedisPubSub[(Redis)]
    NodeAPI -.-> RedisPubSub
```

## 3. Technology Stack

### A. Frontend (Web)
- **Framework:** React 18, Vite
- **Styling:** Tailwind CSS
- **State Management:** Zustand, React Query
- **Routing:** React Router DOM

### B. Backend (API Services)
- **Runtime:** Node.js v20
- **Framework:** Express.js / Hono (depending on service)
- **Validation:** Zod
- **Authentication:** JWT (JSON Web Tokens) with short-lived access and long-lived refresh tokens.

### C. Data & Infrastructure
- **Database:** PostgreSQL 16 (Managed via AWS RDS)
- **Caching & Realtime:** Redis (Pub/Sub for WebSockets, key/value for cache)
- **Object Storage:** AWS S3 for user uploads and media
- **Hosting:** AWS ECS (Docker containers)

## 4. Key Workflows

### Authentication Flow
1. Client POSTs credentials to `/api/v1/auth/login`.
2. Backend verifies hash via bcrypt against `users` table.
3. Backend issues access JWT (15m expiry) and HTTP-only refresh token cookie (7d expiry).
4. Client attaches access JWT in `Authorization: Bearer <token>` for subsequent requests.

### Realtime Events
1. Action happens in HTTP API (e.g., user is mentioned).
2. API service pushes event to Redis `notify:mentions` channel.
3. WebSocket server consuming Redis pushes the payload down the persistent TCP connection to the specific active client. 
