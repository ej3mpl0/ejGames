# Crates parcheados

- `librqbit-dht` 9.0.1 (Apache-2.0, https://github.com/ikatson/rqbit): el lector
  UDP del DHT no se para por los errores que Windows devuelve en `recv_from`
  cuando llega el ICMP de un envío anterior (10054 puerto inaccesible, 10052
  TTL agotado). Sin el parche, el DHT se para al poco de arrancar (rqbit#664).
  El cambio está marcado con «ejGames» en `src/dht.rs`. Quitar este parche
  cuando lo arregle una versión nueva.
