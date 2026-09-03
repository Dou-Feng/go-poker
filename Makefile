.PHONY: start hot deploy

go :
	cd backend && go run .

redis :
	docker compose up -d redis

next :
	cd web && npm run dev

start :
	make go & make next

hot :
	docker compose -f docker-compose-hot.yaml up --build

deploy :
	./deploy.sh
