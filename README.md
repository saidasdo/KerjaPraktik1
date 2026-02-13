
## Table of Contents

- [Project Structure](#project-structure)
- [How to Run](#how-to-run)
  - [Frontend](#frontend)
  - [Backend](#backend)
- [Production Dependencies](#production-dependencies)

---

## Project Structure

This project consists of:
- **Frontend:** Built with Next.js and React.
- **Backend:** Python application in the `backend/` directory.

---

## How to Run

**Prerequisites:**  
- Python environment with required packages installed  
- Node.js & npm installed  
- Properly set up `venv` for Python dependencies

### Frontend

1. Go to the project directory:
    ```bash
    cd /mnt/wdd1/www/htdocs/inarcm2/KerjaPraktik1
    ```
2. Activate the Python virtual environment:
    ```bash
    source venv/bin/activate
    ```
3. Start the frontend:
    ```bash
    npm run dev
    ```

### Backend

1. Go to the project directory:
    ```bash
    cd /mnt/wdd1/www/htdocs/inarcm2/KerjaPraktik1
    ```
2. Activate the Python virtual environment:
    ```bash
    source venv/bin/activate
    ```
3. Enter the backend directory and run the API:
    ```bash
    cd backend
    python api.py
    ```

---

## Production Dependencies

Frontend:
- **next:** 12.3.4
- **react:** 17.0.2
- **react-dom:** 17.0.2
- **leaflet:** 1.9.4
- **react-leaflet:** 3.2.5
- **chart.js:** 3.9.1
- **react-chartjs-2:** 4.3.1

Make sure these dependencies are specified in your `package.json`.

---

## License

[Specify your license here.]
