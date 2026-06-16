# Fortinet Wi-Fi Setup Gids
## FortiGate + FortiAP + FortiSwitch + Windows Server NPS/AD

**Omgeving:** vRijling  
**Beheerder:** Windows 11 Pro laptop  
**Datum:** Juni 2026

---

## Inhoudsopgave

1. [Architectuur & VLAN Ontwerp](#1-architectuur--vlan-ontwerp)
2. [Fase 1 – Windows Server VM (AD DS + NPS + CA)](#fase-1--windows-server-vm)
3. [Fase 2 – FortiGate: VLAN Interfaces aanmaken](#fase-2--fortigate-vlan-interfaces)
4. [Fase 3 – FortiGate: DHCP Scopes](#fase-3--fortigate-dhcp-scopes)
5. [Fase 4 – FortiGate: RADIUS Server koppelen](#fase-4--fortigate-radius-server)
6. [Fase 5 – FortiGate: SSIDs aanmaken](#fase-5--fortigate-ssids-aanmaken)
7. [Fase 6 – FortiGate: FortiAP Profile & Radio's](#fase-6--fortigate-fortiap-profile)
8. [Fase 7 – FortiGate: Firewall Policies](#fase-7--fortigate-firewall-policies)
9. [Fase 8 – FortiSwitch: Port/Trunk Configuratie](#fase-8--fortiswitch-port-configuratie)
10. [Fase 9 – Windows NPS: RADIUS Policies](#fase-9--windows-nps-radius-policies)
11. [Fase 10 – Client WiFi Profielen (802.1x)](#fase-10--client-wifi-profielen)
12. [Fase 11 – Testen & Troubleshooting](#fase-11--testen--troubleshooting)
13. [Samenvatting Uitvoervolgorde (Checklist)](#samenvatting--checklist)

---

## 1. Architectuur & VLAN Ontwerp

### Bestaand netwerk

| Netwerk | Subnet | Gateway | Opmerking |
|---------|--------|---------|-----------|
| Management LAN | 192.168.111.0/24 | 192.168.111.1 (FortiGate) | Servers (NIC1), laptops, beheer |
| Ceph netwerk | 192.168.112.0/24 | 192.168.111.1 (FortiGate) | Servers (NIC0), TP-Link switch 2 |
| DHCP pool LAN | 192.168.111.150–254 | — | Uitgedeeld door FortiGate |

### Nieuwe Wi-Fi VLANs

| VLAN ID | Interface naam | SSID naam | Subnet | Gateway (FortiGate) | DHCP Range | Beveiliging |
|---------|---------------|-----------|--------|---------------------|------------|-------------|
| 20 | vlan20-priv | **vRijlingPriv** | 192.168.20.0/24 | 192.168.20.1 | .100 – .102 | WPA3-SAE + MAC-filter |
| 30 | vlan30-work | **vRijlingWork** | 192.168.30.0/24 | 192.168.30.1 | .100 – .200 | WPA2/3-Enterprise (802.1x) |
| 40 | vlan40-guest | **vRijlingGuest** | 192.168.40.0/24 | 192.168.40.1 | .100 – .249 | Open + Captive Portal |
| 50 | vlan50-iot | **vRijlingIoT** | 192.168.50.0/24 | 192.168.50.1 | .100 – .200 | WPA2-Personal |

### Radio verdeling

| Radio | Band | SSIDs |
|-------|------|-------|
| Radio 1 | 2.4 GHz | vRijlingPriv, vRijlingWork, vRijlingGuest, vRijlingIoT |
| Radio 2 | 5 GHz | vRijlingPriv, vRijlingWork, vRijlingGuest (GEEN IoT) |

> **Opmerking:** IoT apparaten ondersteunen vrijwel altijd alleen 2.4 GHz. Door IoT te beperken tot radio 1 bespaar je radio 2 voor betere throughput op de andere SSIDs.

### Windows Server (nieuw aan te maken)

| Parameter | Waarde |
|-----------|--------|
| Rol | Domain Controller + NPS (RADIUS) + Certificate Authority |
| VM locatie | Proxmox SRV1 (of SRV2) |
| IP | **192.168.111.10** (statisch, buiten DHCP pool) |
| DNS | 192.168.111.10 (eigen AD-DNS) |
| Domain naam | rijling.local (of eigen keuze) |
| OS | Windows Server 2022 (aanbevolen) |

---

## Fase 1 – Windows Server VM

### 1.1 VM aanmaken in Proxmox

Maak een VM aan op SRV1 (of SRV2) met de volgende specs:

- **vCPU:** minimaal 2 cores (4 aanbevolen)
- **RAM:** minimaal 4 GB (8 GB aanbevolen)
- **Schijf:** minimaal 60 GB
- **Netwerk:** bridge gekoppeld aan de FortiSwitch/LAN (192.168.111.0/24)

Stel na installatie van Windows Server een **statisch IP** in:

```
IP-adres:       192.168.111.10
Subnetmasker:   255.255.255.0
Standaard GW:   192.168.111.1
Primaire DNS:   127.0.0.1  (straks wijst de server naar zichzelf)
```

### 1.2 Active Directory Domain Services (AD DS) installeren

1. Open **Server Manager → Manage → Add Roles and Features**
2. Selecteer **Active Directory Domain Services**
3. Doorloop de wizard → klik **Install**
4. Na installatie: klik op de gele **vlag** in Server Manager → **Promote this server to a domain controller**
5. Kies: **Add a new forest**
6. Root domain name: `rijling.local`
7. Forest / Domain Functional Level: **Windows Server 2016** of hoger
8. Stel een **DSRM-wachtwoord** in (bewaar dit veilig)
9. Voltooi de wizard → server herstart automatisch

Na herstart: controleer of AD werkt via `Active Directory Users and Computers`.

### 1.3 AD Groepen en gebruikers aanmaken

Open **Active Directory Users and Computers**:

1. Maak een nieuwe OU aan: `WiFi-Gebruikers`
2. Maak een **Security Group** aan: `WiFi-Medewerkers` (Global, Security)
3. Maak gebruikersaccounts aan voor alle medewerkers
4. Voeg de medewerkers toe aan de groep `WiFi-Medewerkers`
5. (Optioneel) Maak ook een groep `WiFi-Priv-Computers` voor de 3 privélaptops als je later machine-certificaten wilt gebruiken

### 1.4 Active Directory Certificate Services (AD CS) installeren

NPS/PEAP heeft een **servercertificaat** nodig. Installeer een interne CA:

1. **Add Roles and Features → Active Directory Certificate Services**
2. Role Services: alleen **Certification Authority**
3. Type: **Enterprise CA**
4. CA Type: **Root CA**
5. Nieuwe private key: **RSA 2048-bit** (of 4096)
6. Geldigheidsperiode: 10 jaar (voor een Root CA)
7. Voltooi de installatie

> **Belangrijk:** Domain-joined computers krijgen het CA-certificaat automatisch via Group Policy vertrouwd. Niet-domain-joined clients (bijv. persoonlijke meegebrachte laptops van medewerkers) moeten het CA-certificaat handmatig importeren als Trusted Root.

### 1.5 Network Policy Server (NPS) installeren

1. **Add Roles and Features → Network Policy and Access Services**
2. Role Services: **Network Policy Server**
3. Installeer → klik **Finish**

Open de NPS-console via: Start → **Network Policy Server**

---

## Fase 2 – FortiGate: VLAN Interfaces

Log in op de FortiGate GUI: `https://192.168.111.1`

Ga naar **Network → Interfaces → Create New → Interface**

> **Technische noot:** De FortiAP wordt beheerd via de FortiSwitch (FortiLink). In de Fortinet Fabric is de "parent interface" van de nieuwe VLANs de **FortiLink interface** (bijv. `fortilink` of `internal`), niet direct `port1`. Controleer welke interface jouw FortiSwitch beheert in **WiFi & Switch Controller → Managed FortiSwitches**.

### VLAN 20 – vRijlingPriv

| Veld | Waarde |
|------|--------|
| Name | `vlan20-priv` |
| Type | VLAN |
| Interface (parent) | FortiLink interface (bijv. `fortilink`) |
| VLAN ID | `20` |
| Role | LAN |
| IP/Netmask | `192.168.20.1/24` |
| Administrative Access | HTTPS, PING (optioneel) |

### VLAN 30 – vRijlingWork

| Veld | Waarde |
|------|--------|
| Name | `vlan30-work` |
| VLAN ID | `30` |
| IP/Netmask | `192.168.30.1/24` |

### VLAN 40 – vRijlingGuest

| Veld | Waarde |
|------|--------|
| Name | `vlan40-guest` |
| VLAN ID | `40` |
| IP/Netmask | `192.168.40.1/24` |

### VLAN 50 – vRijlingIoT

| Veld | Waarde |
|------|--------|
| Name | `vlan50-iot` |
| VLAN ID | `50` |
| IP/Netmask | `192.168.50.1/24` |

---

## Fase 3 – FortiGate: DHCP Scopes

Ga naar **Network → DHCP Servers → Create New** (één per VLAN):

### DHCP voor VLAN 20 (vRijlingPriv)

| Veld | Waarde |
|------|--------|
| Interface | `vlan20-priv` |
| Address Range | 192.168.20.100 – 192.168.20.102 |
| Netmask | 255.255.255.0 |
| Default Gateway | 192.168.20.1 |
| DNS Server 1 | 192.168.111.10 (Windows Server) |
| Lease Time | 8 uur |

> Slechts 3 adressen in de pool: alleen de 3 bekende laptops mogen een lease krijgen (MAC-filter doet de verdere beveiliging).

### DHCP voor VLAN 30 (vRijlingWork)

| Veld | Waarde |
|------|--------|
| Interface | `vlan30-work` |
| Address Range | 192.168.30.100 – 192.168.30.200 |
| Default Gateway | 192.168.30.1 |
| DNS Server 1 | 192.168.111.10 |

### DHCP voor VLAN 40 (vRijlingGuest)

| Veld | Waarde |
|------|--------|
| Interface | `vlan40-guest` |
| Address Range | 192.168.40.100 – 192.168.40.249 |
| Default Gateway | 192.168.40.1 |
| DNS Server 1 | `8.8.8.8` (Google — géén intern DNS voor gasten) |
| DNS Server 2 | `8.8.4.4` |
| Lease Time | 2 uur (kort, zodat leases snel vrijkomen) |

### DHCP voor VLAN 50 (vRijlingIoT)

| Veld | Waarde |
|------|--------|
| Interface | `vlan50-iot` |
| Address Range | 192.168.50.100 – 192.168.50.200 |
| Default Gateway | 192.168.50.1 |
| DNS Server 1 | `8.8.8.8` |

---

## Fase 4 – FortiGate: RADIUS Server

Ga naar **User & Authentication → RADIUS Servers → Create New**:

| Veld | Waarde |
|------|--------|
| Name | `Windows-NPS` |
| Server IP/Name | `192.168.111.10` |
| Server Secret | `[kies een sterk gedeeld geheim, bijv. 20+ tekens]` |
| Authentication method | Default (EAP wordt automatisch gepassthrough) |
| NAS IP | 192.168.111.1 (FortiGate LAN IP) |

Klik **OK**. 

Gebruik de knop **Test Connectivity** nadat NPS geconfigureerd is (Fase 9) om de verbinding te verifiëren.

> **Let op:** Het "Server Secret" dat je hier instelt moet **exact hetzelfde** zijn als wat je later in NPS instelt bij de RADIUS Client configuratie. Bewaar het veilig.

---

## Fase 5 – FortiGate: SSIDs aanmaken

Ga naar **WiFi & Switch Controller → SSIDs → Create New → SSID**

### 5.1 SSID: vRijlingPriv (Privé laptops, WPA3 + MAC filter)

| Veld | Waarde |
|------|--------|
| SSID naam | `vRijlingPriv` |
| Traffic Mode | Tunnel to Wireless Controller |
| Security | WPA3-SAE (of WPA2/WPA3-SAE Mixed voor compat.) |
| Pre-shared Key | `[minimaal 20 tekens, sterk wachtwoord]` |
| VLAN | `20` |
| Broadcast SSID | Optioneel: Hidden (extra obscurity) |
| Band Steering | Enabled (stuurt dual-band clients naar 5 GHz) |

**MAC Filter instellen:**

Scroll naar beneden naar **MAC Filter**:
- MAC Filter: **Enabled**
- Filter Type: **Allow** (whitelist)
- Voeg de MAC-adressen van de 3 laptops toe

```
Achterhaal MAC-adressen op de laptops met:
  Windows: ipconfig /all  →  "Physical Address"
  Formaat in FortiGate: xx:xx:xx:xx:xx:xx
```

### 5.2 SSID: vRijlingWork (Medewerkers, 802.1x)

| Veld | Waarde |
|------|--------|
| SSID naam | `vRijlingWork` |
| Traffic Mode | Tunnel to Wireless Controller |
| Security | WPA2/WPA3-Enterprise |
| Authentication | RADIUS Server |
| RADIUS Server | `Windows-NPS` |
| VLAN | `30` |
| Band Steering | Enabled |

### 5.3 SSID: vRijlingGuest (Gasten, Captive Portal)

| Veld | Waarde |
|------|--------|
| SSID naam | `vRijlingGuest` |
| Traffic Mode | Tunnel to Wireless Controller |
| Security | **Open** (Captive portal vereist een open SSID) |
| VLAN | `40` |

Na aanmaken: ga naar **Network → Interfaces → vlan40-guest** en stel in:
- **Security Mode:** Captive Portal
- **Portal Type:** Disclaimer Only (gasten accepteren voorwaarden, daarna internet)  
  *Of: Local Users (gasten krijgen een voucher/wachtwoord)*
- **Redirect after Disclaiming:** allow internet access

> **Optie voor hogere beveiliging:** gebruik **OWE (Opportunistic Wireless Encryption)** als jouw FortiAP dit ondersteunt. OWE geeft open WiFi versleuteling zonder wachtwoord — ideaal voor gast-WiFi.

### 5.4 SSID: vRijlingIoT (IoT, alleen 2.4 GHz)

| Veld | Waarde |
|------|--------|
| SSID naam | `vRijlingIoT` |
| Traffic Mode | Tunnel to Wireless Controller |
| Security | WPA2-Personal |
| Pre-shared Key | `[IoT wachtwoord, sterk maar intoetsbaar op apparaten]` |
| VLAN | `50` |

> Dit SSID zal straks in het AP Profile **alleen** op Radio 1 (2.4 GHz) worden gezet, niet op 5 GHz.

---

## Fase 6 – FortiGate: FortiAP Profile

Ga naar **WiFi & Switch Controller → AP Profiles → Create New**

- **Profile Name:** `vRijling-AP-Profile`
- **Platform:** kies jouw FortiAP model (bijv. FAP-231F, FAP-431F, etc.)

### Radio 1 – 2.4 GHz

| Parameter | Waarde |
|-----------|--------|
| Mode | AP |
| Band | 802.11n/g/b (2.4 GHz) |
| Channel | Auto (of handmatig: 1, 6 of 11) |
| TX Power Control | Auto |
| SSIDs | vRijlingPriv, vRijlingWork, vRijlingGuest, vRijlingIoT |

### Radio 2 – 5 GHz

| Parameter | Waarde |
|-----------|--------|
| Mode | AP |
| Band | 802.11ac/n/a (5 GHz) of 802.11ax als je FortiAP Wi-Fi 6 ondersteunt |
| Channel | Auto (of bijv. 36, 40, 44, 48 voor DFS-vrije kanalen) |
| TX Power Control | Auto |
| SSIDs | vRijlingPriv, vRijlingWork, vRijlingGuest |

> **IoT NIET toevoegen aan Radio 2.** IoT apparaten horen thuis op 2.4 GHz.

### Band Steering

Schakel **Band Steering** in op het AP-profiel niveau als dit beschikbaar is. Band Steering stuurt clients die zowel 2.4 als 5 GHz ondersteunen actief naar het 5 GHz-netwerk voor betere prestaties.

### FortiAP autoriseren en profiel toewijzen

1. Ga naar **WiFi & Switch Controller → Managed FortiAPs**
2. Je FortiAP verschijnt hier als het correct verbonden is via de FortiSwitch
3. Klik op het AP → **Authorize** (als nog niet gedaan)
4. Stel het **AP Profile** in op `vRijling-AP-Profile`
5. Klik **Apply**

> **Volledig dekkende coverage:** Met één FortiAP is volledige dekking afhankelijk van de fysieke locatie en het gebouw. Zet het AP zo centraal mogelijk. Stel de TX Power in op Auto zodat FortiGate de beste instelling kiest. Als je meer ruimten moet dekken, heb je meerdere APs nodig.

---

## Fase 7 – FortiGate: Firewall Policies

Ga naar **Policy & Objects → Firewall Policy → Create New**

### Policy 1 – vRijlingPriv → Internet

| Veld | Waarde |
|------|--------|
| Name | `WiFi-Priv-to-WAN` |
| Incoming Interface | `vlan20-priv` |
| Outgoing Interface | WAN interface (bijv. `wan1` of `port2`) |
| Source | all |
| Destination | all |
| Service | ALL |
| Action | Accept |
| NAT | Enabled (outbound) |
| Security Profiles | Naar wens inschakelen (AV, Web Filter) |

### Policy 2 – vRijlingPriv → Intern LAN

| Veld | Waarde |
|------|--------|
| Name | `WiFi-Priv-to-LAN` |
| Incoming Interface | `vlan20-priv` |
| Outgoing Interface | `port1` (of de LAN interface, 192.168.111.0/24) |
| Source | all |
| Destination | all |
| Service | ALL |
| Action | Accept |

> De privélaptops mogen wél het interne netwerk bereiken (servers, NAS, etc.).

### Policy 3 – vRijlingWork → Internet

| Veld | Waarde |
|------|--------|
| Name | `WiFi-Work-to-WAN` |
| Incoming Interface | `vlan30-work` |
| Outgoing Interface | WAN |
| Source | all |
| Destination | all |
| Action | Accept |
| NAT | Enabled |

### Policy 4 – vRijlingWork → Intern LAN (optioneel)

| Veld | Waarde |
|------|--------|
| Name | `WiFi-Work-to-LAN` |
| Incoming Interface | `vlan30-work` |
| Outgoing Interface | `port1` |
| Service | Beperk naar behoefte (bijv. alleen SMB, RDP, HTTP) |
| Action | Accept |

### Policy 5 – vRijlingGuest → Internet (ALLEEN internet!)

| Veld | Waarde |
|------|--------|
| Name | `WiFi-Guest-to-WAN` |
| Incoming Interface | `vlan40-guest` |
| Outgoing Interface | WAN |
| Source | all |
| Destination | all |
| Action | Accept |
| NAT | Enabled |
| Traffic Shaping | Optioneel: max 10 Mbps download per client |

> **Kritisch:** Maak GEEN policy van vlan40-guest naar het interne LAN. Gasten mogen het interne netwerk nooit bereiken.

### Policy 6 – vRijlingIoT → Internet (beperkt)

| Veld | Waarde |
|------|--------|
| Name | `WiFi-IoT-to-WAN` |
| Incoming Interface | `vlan50-iot` |
| Outgoing Interface | WAN |
| Source | all |
| Destination | all |
| Service | HTTP, HTTPS (of ALL indien IoT NTP etc. nodig heeft) |
| Action | Accept |
| NAT | Enabled |

> **Kritisch:** Maak GEEN policy van IoT naar het LAN of andere VLANs. IoT-apparaten zijn een veiligheidsrisico en mogen volledig geïsoleerd blijven.

**Policy volgorde is belangrijk!** Zorg dat meer specifieke policies boven algemene staan in de lijst.

---

## Fase 8 – FortiSwitch: Port Configuratie

De FortiSwitch wordt **volledig beheerd vanuit de FortiGate** via FortiLink. Je hoeft dus niet in te loggen op de FortiSwitch zelf.

### Trunk configureren naar de FortiAP-port

Ga naar **WiFi & Switch Controller → FortiSwitch Ports**:

1. Selecteer de **FortiSwitch** in de lijst
2. Klik op de **port waarop de FortiAP is aangesloten**
3. Stel in:
   - **VLAN (native):** Management VLAN (standaard VLAN 1 of de bestaande LAN VLAN)
   - **Allowed VLANs:** voeg toe: `vlan20-priv`, `vlan30-work`, `vlan40-guest`, `vlan50-iot`
   - **Mode:** Trunk

Of via de FortiGate CLI:

```bash
config switch-controller managed-switch
    edit "FS-SERIALNUMBER"     # vul jouw FortiSwitch serienummer in
        config ports
            edit "portX"       # de port waar de FortiAP op zit
                set native-vlan "default"
                set allowed-vlans "vlan20-priv vlan30-work vlan40-guest vlan50-iot"
                set untagged-vlans "default"
            next
        end
    next
end
```

> **Fortinet Fabric:** In een correcte FortiLink-setup worden VLAN-interfaces die je op de FortiGate aanmaakt **automatisch** als allowed VLANs aan de FortiSwitch trunks doorgegeven. Controleer dit via **WiFi & Switch Controller → FortiSwitch VLANs**.

---

## Fase 9 – Windows NPS: RADIUS Policies

Open de **NPS-console** op je Windows Server (Start → Network Policy Server).

### 9.1 FortiGate als RADIUS Client registreren

Ga naar **RADIUS Clients and Servers → RADIUS Clients → New**:

| Veld | Waarde |
|------|--------|
| Friendly Name | `FortiGate-LAN` |
| Address (IP of DNS) | `192.168.111.1` (FortiGate LAN interface) |
| Shared Secret | `[zelfde geheim als ingesteld in Fase 4]` |
| Vendor | RADIUS Standard |

Klik **OK**.

### 9.2 Connection Request Policy

Ga naar **Policies → Connection Request Policies → New**:

| Veld | Waarde |
|------|--------|
| Policy Name | `WiFi-Verbindingsaanvragen` |
| Network Access Server Type | Unspecified |
| Authentication | Authenticate requests on this server |

Klik **Finish** (geen speciale conditions nodig voor een basisconfiguratie).

### 9.3 Network Policy voor medewerkers WiFi

Ga naar **Policies → Network Policies → New**:

**Stap 1 – Naam en type:**
- Policy Name: `WiFi-Medewerkers-Toegang`
- Network Access Server Type: Unspecified

**Stap 2 – Conditions:**
- Klik **Add → Windows Groups**
- Klik **Add Groups** → voer in: `WiFi-Medewerkers` → OK
- Dit betekent: alleen leden van de AD-groep `WiFi-Medewerkers` krijgen toegang

**Stap 3 – Access Permission:**
- Selecteer: **Grant access**

**Stap 4 – Authentication Methods:**
- Verwijder eventuele andere EAP-types
- Klik **Add → EAP Types → Microsoft: Protected EAP (PEAP)**
- Klik **Edit PEAP:**
  - Certificate issued to: selecteer het **NPS-servercertificaat** (uitgedeeld door de interne CA)
  - Inner EAP method: **Microsoft: Secured Password (EAP-MSCHAP v2)**
- Klik **OK**

> **Optie hogere beveiliging (EAP-TLS):** Voeg ook **Smart Card or other certificate (EAP-TLS)** toe als je wilt authenticeren met machine-certificaten in plaats van wachtwoorden. Dit vereist dat elke laptop ook een clientcertificaat heeft van de interne CA. Voor PEAP-MSCHAPv2 is alleen een gebruikersnaam + wachtwoord nodig.

**Stap 5 – Constraints:** optionele instellingen als time-of-day restrictions, idle timeout.

Klik **Finish**.

### 9.4 NPS Event Logging inschakelen

Ga naar **Accounting → Configure Accounting**:
- **Log Successful Authentications:** Enabled
- **Log Failed Authentications:** Enabled

Dit is essentieel voor troubleshooting. Logs zijn zichtbaar via Event Viewer → **Custom Views → Server Roles → Network Policy and Access Services**.

---

## Fase 10 – Client WiFi Profielen (802.1x)

### 10.1 Automatisch via Group Policy (aanbevolen voor domain-joined laptops)

Als de medewerkerslaptops zijn toegetreden tot het domein `rijling.local`, kun je het WiFi-profiel automatisch uitrollen:

1. Open **Group Policy Management** op de domain controller
2. Maak een nieuwe GPO aan: `WiFi-Medewerkers-Profiel`
3. Ga naar: **Computer Configuration → Policies → Windows Settings → Security Settings → Wireless Network (IEEE 802.11) Policies**
4. Klik **Create a new Windows Vista and later policy** → **Add**
5. Vul in:
   - Profile Name: `vRijlingWork`
   - SSID: `vRijlingWork`
   - Connection Type: Infrastructure
   - Security Type: WPA2-Enterprise (of WPA3-Enterprise)
   - Encryption: AES
6. Ga naar het tabblad **Security → Properties:**
   - Authentication method: Microsoft: Protected EAP (PEAP)
   - Validate server certificate: **Enabled**
   - Trusted Root CA: selecteer jouw interne CA
   - Authentication method (EAP inner): Secured Password (EAP-MSCHAP v2)
   - **Enable Fast Reconnect:** Enabled (minder vertraging bij reconnect)
7. Koppel de GPO aan de **OU** met de medewerkers-computeraccounts
8. Laptops ontvangen het profiel bij de volgende Group Policy refresh (`gpupdate /force` of na herstart)

### 10.2 Handmatig (voor niet-domain-joined laptops)

Op Windows 11:

1. Instellingen → Netwerk en Internet → Wi-Fi → **Bekende netwerken beheren → Netwerk toevoegen**
2. Netwerknaam: `vRijlingWork`
3. Beveiligingstype: WPA2-Enterprise of WPA3-Enterprise
4. EAP-methode: PEAP
5. Fase 2-authenticatie: MSCHAPv2
6. Vink "Servercertificaat valideren" aan → selecteer de CA van `rijling.local` (na handmatige import)
7. Verbind → voer gebruikersnaam + wachtwoord in van het AD-account

**CA-certificaat handmatig importeren (niet-domain-joined):**
1. Exporteer het CA-certificaat van Windows Server: `certmgr.msc → Trusted Root → Exporteren als .cer`
2. Op de laptop: dubbelklik op het .cer bestand → **Certificaat installeren → Local Machine → Trusted Root Certification Authorities**

---

## Fase 11 – Testen & Troubleshooting

### 11.1 Testplan per SSID

**vRijlingPriv:**
- Verbind met WPA3 wachtwoord → verwacht IP: 192.168.20.x
- Controleer internettoegang ✓
- Verbind een apparaat dat NIET in de MAC-lijst staat → verwacht: verbinding geweigerd ✓
- Controleer toegang tot 192.168.111.x (intern LAN) ✓

**vRijlingWork:**
- Verbind met een gebruiker die LID is van `WiFi-Medewerkers` → verwacht: IP 192.168.30.x ✓
- Verbind met een gebruiker die GEEN lid is → verwacht: authenticatie geweigerd ✓
- Controleer NPS event log (Event ID 6272 = geslaagd, 6273 = geweigerd)

**vRijlingGuest:**
- Verbind → verwacht IP: 192.168.40.x
- Open browser → captive portal pagina verschijnt ✓
- Accepteer voorwaarden → internettoegang ✓
- Probeer 192.168.111.x te pingen → verwacht: geen toegang ✓

**vRijlingIoT:**
- Verbind IoT apparaat → verwacht IP: 192.168.50.x
- Internettoegang werkt ✓
- Probeer 192.168.30.x te pingen → verwacht: geen toegang ✓

### 11.2 FortiGate CLI Diagnose Commando's

```bash
# Overzicht verbonden WiFi clients
diagnose wireless-controller wlac -c sta

# RADIUS authenticatie handmatig testen (vervang waarden)
diagnose test authserver radius Windows-NPS pap gebruikersnaam wachtwoord

# DHCP leases per interface bekijken
get system dhcp lease-list vlan30-work

# Actieve firewall sessies filteren op subnet
diagnose sys session list | grep 192.168.40

# AP-status en VAP tabel
diagnose wireless-controller wlac -c vap-table

# FortiSwitch VLAN tabel controleren
get switch-controller managed-switch <serienummer> vlans
```

### 11.3 NPS Event Log (Windows Server)

Event Viewer → **Custom Views → Server Roles → Network Policy and Access Services**

| Event ID | Betekenis |
|----------|-----------|
| 6272 | Toegang verleend (authenticatie geslaagd) |
| 6273 | Toegang geweigerd — bekijk de **Reason Code** in het event |
| 6274 | Aanvraag genegeerd door policy |

**Veelvoorkomende Reason Codes bij Event 6273:**

| Reason Code | Oorzaak | Oplossing |
|-------------|---------|-----------|
| 16 | Authenticatie mislukt | Verkeerd wachtwoord of gebruiker bestaat niet in AD |
| 22 | Access policy verwijderde toegang | Gebruiker zit niet in de `WiFi-Medewerkers` groep |
| 48 | Wachtwoord verlopen | Gebruiker moet wachtwoord vernieuwen |
| 65 | EAP methode mismatch | Client gebruikt een andere EAP methode dan NPS verwacht |

### 11.4 Veelvoorkomende Problemen & Oplossingen

| Probleem | Oorzaak | Oplossing |
|---------|---------|-----------|
| 802.1x authenticatie mislukt | Fout shared secret | Controleer het secret op FortiGate (Fase 4) én NPS (Fase 9.1) — beide identiek |
| "Certificate error" op client laptop | CA niet vertrouwd | Installeer CA-cert handmatig of via GPO |
| Captive portal verschijnt niet | Client maakt HTTPS-verbinding | Zorg dat client eerst http:// bezoekt; of stel een DNS redirect in |
| MAC filter werkt niet | Verkeerd MAC-formaat | Gebruik formaat `aa:bb:cc:dd:ee:ff` en controleer of MAC correct is |
| Client krijgt geen IP-adres | DHCP niet actief op VLAN | Controleer FortiGate Network → DHCP Servers, juiste interface geselecteerd? |
| Medewerkers SSID niet zichtbaar op 5 GHz | SSID niet op Radio 2 | Controleer AP Profile: vRijlingWork op Radio 2 toevoegen |
| IoT SSID zichtbaar op 5 GHz | Fout in AP Profile | Verwijder vRijlingIoT van Radio 2, enkel Radio 1 (2.4 GHz) |

---

## Samenvatting – Checklist

Hieronder de aanbevolen uitvoervolgorde:

```
[ ] 1.  Windows Server 2022 VM aanmaken op Proxmox (IP: 192.168.111.10)
[ ] 2.  AD DS installeren → domain aanmaken: rijling.local
[ ] 3.  AD CS installeren → interne Root CA aanmaken
[ ] 4.  NPS installeren
[ ] 5.  AD OU + Security Group 'WiFi-Medewerkers' + gebruikers aanmaken
[ ] 6.  FortiGate: VLAN Interfaces aanmaken (VLAN 20, 30, 40, 50)
[ ] 7.  FortiGate: DHCP Scopes per VLAN instellen
[ ] 8.  FortiGate: RADIUS Server 'Windows-NPS' toevoegen
[ ] 9.  FortiGate: 4x SSID aanmaken (Priv, Work, Guest, IoT)
[ ] 10. FortiGate: AP Profile aanmaken, SSIDs op juiste radio's
[ ] 11. FortiGate: FortiAP autoriseren + AP Profile toewijzen
[ ] 12. FortiGate: Firewall Policies aanmaken per VLAN
[ ] 13. FortiSwitch: Port naar FortiAP als trunk configureren
[ ] 14. Windows NPS: FortiGate als RADIUS Client toevoegen
[ ] 15. Windows NPS: Connection Request Policy aanmaken
[ ] 16. Windows NPS: Network Policy voor WiFi-Medewerkers aanmaken
[ ] 17. Group Policy: WiFi-profiel vRijlingWork uitrollen naar domain-joined laptops
[ ] 18. Testen: alle 4 SSIDs verifiëren (zie Fase 11.1)
[ ] 19. Monitoring: NPS logs + FortiGate logs controleren
```

---

*Documentversie 1.0 — Gegenereerd voor de vRijling omgeving*
