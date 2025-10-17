# Pizzeria Molino Molard - Planning & Information Platform

## Overview

The Pizzeria Molino Molard platform is a multi-page web application designed to centralize employee scheduling, training materials, company regulations, and customer feedback for a restaurant organization. The application serves multiple departments (Kitchen/Cuisine, Pizzeria, Service, Bar, Commis, Office, and Management) with dedicated planning pages that link to Google Drive documents for weekly and monthly schedules. Additionally, it provides access to training videos, chef proposals, company policies, and other operational resources.

The platform is built as a static front-end application with a lightweight Express.js server for potential future API integrations, particularly with Firebase for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Static Multi-Page Application**: The application follows a traditional multi-page website structure with individual HTML files for each section. This approach prioritizes simplicity and ease of maintenance without requiring a build process or complex frontend framework.

**Pages Organization**:
- Main navigation hub (`index.html`)
- Department-specific planning pages (`cuisine.html`, `pizzeria.html`, `service.html`, `bar.html`, `commis.html`, `office.html`, `respo.html`)
- Content pages for training, proposals, regulations (`formazioni.html`, `formazioni-interattive.html`, `proposta.html`, `reglement.html`)
- Additional resources (`video.html`, `Commenti.html`, `stock.html`)

**Styling Strategy**: Centralized CSS (`style.css`) with shared styling across all pages. The design uses a consistent color scheme (primary: #76d7c4 teal/turquoise) and header background image for brand consistency.

**Design Rationale**: Multi-page HTML was chosen over a SPA framework to minimize technical complexity, enable easy content updates by non-technical staff, and ensure compatibility with all devices without requiring JavaScript for basic functionality.

### Backend Architecture

**Express.js Server** (`server.js`): Minimal Node.js server currently serving static files and providing placeholder API endpoints for future Firebase integration.

**Current Server Functions**:
- Static file serving for HTML, CSS, and JavaScript files
- JSON body parsing middleware
- API routes for planning save/retrieve operations
- Training management API endpoints:
  - `POST /api/training/enroll` - Enroll users in trainings
  - `GET /api/training/enrollments/:userId` - Retrieve user enrollments
  - `POST /api/training/complete/:enrollmentId` - Mark training as completed
  - `GET /api/training/available` - List available trainings
- In-memory storage for training enrollments (can be migrated to Firebase)

**Design Philosophy**: The server layer is intentionally lightweight, acting primarily as a static file server with hooks for future data persistence. This allows the application to function entirely client-side while maintaining extensibility.

### Data Storage Strategy

**Current Approach - External Links**: All planning documents and training materials are stored on Google Drive, with the application providing organized links to these resources. This keeps the application lightweight and leverages familiar tools (Google Drive) for document management.

**Planned Integration - Firebase**: Configuration files (`firebase-config.js`, `firebase-client.js`) indicate planned integration with Firebase for:
- Firestore for storing planning data directly in the application
- Firebase Authentication for user management
- Potential future features like interactive training enrollment

**Trade-offs**: 
- **Pro**: Google Drive links allow non-technical staff to update documents independently
- **Pro**: Firebase integration would enable offline access, better search, and interactive features
- **Con**: Current approach requires manual link updates when documents change
- **Con**: No built-in version control for planning documents

### Client-Side Features

**PDF.js Integration**: Multiple pages include PDF.js CDN for in-browser PDF viewing capabilities, though actual implementation is incomplete.

**jsPDF Library**: Included in dependencies and referenced in `formazioni-interattive.html` for potential PDF generation features (training certificates, printed schedules).

**Interactive Training System**: The `formazioni-interattive.html` page implements a complete interactive training enrollment system with the following features:
- User enrollment with name, surname, and department tracking
- Progress tracking for each training course
- Automatic diploma generation with personalized PDF certificates
- Integration with backend API for data persistence
- Real-time status updates and completion tracking

## External Dependencies

### Third-Party Services

**Google Drive**: Primary content storage and delivery system for all planning documents (PDFs), training materials, chef proposal videos, and company policy documents. Each department has dedicated folders with weekly and monthly planning documents.

**CDN Resources**:
- PDF.js (v2.12.313) via cdnjs.cloudflare.com - for PDF viewing in browser
- jsPDF (v2.5.1) via cdnjs.cloudflare.com - for PDF generation

### NPM Packages

**Core Server Dependencies**:
- `express` (^4.18.2) - Web server framework
- `cors` (^2.8.5) - Cross-origin resource sharing middleware

**Firebase SDK** (^12.4.0): Complete Firebase client SDK including:
- Firestore for NoSQL database operations
- Authentication for user management
- Multiple Firebase service modules (@firebase/ai, @firebase/analytics, etc.)

**Document Processing**:
- `xlsx` (^0.18.5) - Excel file parsing and generation (for potential planning import/export)
- `jspdf` (^3.0.3) - Client-side PDF generation
- `jspdf-autotable` (^5.0.2) - Table generation for jsPDF

### Integration Points

**Firebase Configuration**: Placeholder configuration in `firebase-config.js` requires actual Firebase project credentials (API key, project ID, etc.) to be populated before Firebase features can be activated.

**Google Drive Sharing**: All planning documents use Google Drive share links with view permissions. Links follow pattern: `drive.google.com/file/d/{FILE_ID}/view`

**Future API Endpoints**: Server includes stubbed endpoints (`/api/save-planning`, `/api/get-planning/:week/:department`) designed to integrate with Firebase for CRUD operations on planning data.