# Zelana Prover – Kubernetes Deployment

A local guide for deploying the **Zelana Prover distributed system** on Kubernetes using **Minikube**.

---

## Prerequisites

Make sure you have the following installed:

* [Docker](https://www.docker.com/get-started)
* [Minikube](https://minikube.sigs.k8s.io/docs/start/)
* `kubectl` (CLI for Kubernetes)

Check versions:

```bash
docker --version
minikube version
kubectl version --client
```

---

## 1. Start Minikube Cluster

Start a local Kubernetes cluster:

```bash
minikube start --cpus=2 --memory=8g
```

Check status:

```bash
minikube status
```

* **Running** → cluster is active
* **Stopped** → cluster is off

---

## 2. Build Docker Images

From the project root:

```bash
./scripts/deploy-k8s.sh
```

**Notes:**

* This builds two images: `zelana/prover-node` and `zelana/prover-coordinator`.
* If using Minikube, images are automatically loaded into the cluster.

---

## 3. Apply Kubernetes Manifests

The deployment script applies all manifests in `deploy/k8s`:

* Namespace: `zelana-prover`
* StatefulSet: `prover-node`
* Deployment: `coordinator`
* Services: `prover-node` and `coordinator`

Check pods and services:

```bash
kubectl get pods -n zelana-prover
kubectl get services -n zelana-prover
```

---

## 4. Access Coordinator

Forward the coordinator service port to your local machine:

```bash
kubectl port-forward -n zelana-prover svc/coordinator 8080:8080
```

Test the health endpoint:

```bash
curl http://localhost:8080/health
```

---

## 5. View Logs

Coordinator logs:

```bash
kubectl logs -n zelana-prover -l app=coordinator
```

Prover node logs:

```bash
kubectl logs -n zelana-prover -l app=prover-node
```

---

## 6. Stop or Delete Cluster

* **Stop Minikube (temporary, keeps data)**

```bash
minikube stop
```

* **Delete Minikube (removes cluster completely)**

```bash
minikube delete
```

---

## 7. Re-deploy

If the cluster was stopped or deleted:

```bash
minikube start
./scripts/deploy-k8s.sh
```

---

## Troubleshooting

* If `kubectl` cannot connect:

```bash
minikube start
kubectl config use-context minikube
```

* Ensure Docker is running locally and Minikube can access it:

```bash
docker ps
minikube docker-env
```
