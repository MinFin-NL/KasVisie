FROM python:3.11-slim

WORKDIR /app

COPY . ./

RUN rm -rf /usr/local/lib/python3.11/site-packages/setuptools* \
           /usr/local/lib/python3.11/dist-packages/setuptools* \
           /usr/local/lib/python3.11/ensurepip/_bundled/setuptools*

RUN pip uninstall -y setuptools || true
RUN pip install --no-cache-dir pip==25.3
RUn pip install --no-cache-dir setuptools==82.0.1
RUN rm -rf /usr/local/lib/python3.11/ensurepip/_bundled/setuptools-80.10.1-py3-none-any.whl
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir setuptools==82.0.1

COPY data ./data/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]