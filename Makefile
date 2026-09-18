.PHONY: go redis next start hot deploy test

go :
	cd backend && go run ./cmd/go-poker

redis :
	docker compose up -d redis

next :
	cd web && npm run dev

start :
	$(MAKE) go & $(MAKE) next

test :
	cd backend && go test ./...
	cd web && npm run type-check
	cd web && node --test tests/*.test.cjs

hot :
	docker compose -f docker-compose-hot.yaml up --build

dev :
	docker compose -f docker-compose-dev.yaml up --build

dev-down:
	docker compose -f docker-compose-dev.yaml down

deploy :
	./deploy.sh
