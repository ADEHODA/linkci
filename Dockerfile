FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/static/avatars /app/static/uploads /app/uploads
EXPOSE 5000
CMD ["gunicorn", "-w", "1", "--threads", "50", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "wsgi:app"]
