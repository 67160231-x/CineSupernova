FROM node:22-alpine
WORKDIR /app

# แยก layer cache: ติดตั้ง dependency ก่อน copy โค้ดทั้งหมด (build ใหม่เร็วขึ้นเวลาแก้แค่โค้ด)
COPY Backend/package*.json ./Backend/
RUN npm install --prefix ./Backend --omit=dev

# copy โค้ดจริงเข้าไป (คง path relative ../Frontend/CineSupernova-main ที่ server.js ใช้อยู่)
COPY Backend ./Backend
COPY Frontend ./Frontend

WORKDIR /app/Backend
EXPOSE 3000
CMD ["node", "server.js"]