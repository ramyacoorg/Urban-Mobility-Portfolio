
// Pedestrian Roadmap & Guidance — Client-side demo
(function(){
  const STAD = {lat: 12.978813, lng: 77.5996565};
  const map = L.map('map').setView([STAD.lat, STAD.lng], 17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);

  // stadium marker & circle
  L.marker([STAD.lat, STAD.lng]).addTo(map).bindPopup('M. Chinnaswamy Stadium');
  L.circle([STAD.lat, STAD.lng], {radius:120, color:'#7b61ff', weight:2, fill:true, fillOpacity:0.06}).addTo(map);

  // UI refs
  const toggleSim = document.getElementById('toggleSim');
  const clusterCount = document.getElementById('clusterCount');
  const modeLabel = document.getElementById('modeLabel');
  const lastAlert = document.getElementById('lastAlert');
  const startInfo = document.getElementById('startInfo');
  const destInfo = document.getElementById('destInfo');
  const routeRisk = document.getElementById('routeRisk');
  const riskZones = document.getElementById('riskZones');
  const setDemo = document.getElementById('setDemo');
  const computeRouteBtn = document.getElementById('computeRoute');
  const droneWarn = document.getElementById('droneWarn');

  // layers
  const clustersLayer = L.layerGroup().addTo(map);
  const exitsLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const debugLayer = L.layerGroup().addTo(map);

  // sample exits (from data/exits.geojson)
  const EXITS = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": "North Gate", "type": "exit"}, "geometry": {"type": "Point", "coordinates": [77.5996565, 12.980013000000001]}}, {"type": "Feature", "properties": {"name": "East Gate", "type": "exit"}, "geometry": {"type": "Point", "coordinates": [77.6009565, 12.978813]}}, {"type": "Feature", "properties": {"name": "South Gate", "type": "exit"}, "geometry": {"type": "Point", "coordinates": [77.5996565, 12.977713000000001]}}, {"type": "Feature", "properties": {"name": "West Gate", "type": "exit"}, "geometry": {"type": "Point", "coordinates": [77.59825649999999, 12.978813]}}, {"type": "Feature", "properties": {"name": "Choke Point 1", "type": "choke"}, "geometry": {"type": "Point", "coordinates": [77.6002565, 12.979213000000001]}}, {"type": "Feature", "properties": {"name": "Open Space", "type": "open"}, "geometry": {"type": "Point", "coordinates": [77.5987565, 12.979613]}}]};

  // build exits
  function loadExits(){
    exitsLayer.clearLayers();
    EXITS.features.forEach(f=>{
      const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
      const color = f.properties.type==='exit' ? '#31c46f' : '#ffb84a';
      const m = L.circleMarker(coords, {radius:8, color:color, fillOpacity:0.9}).addTo(exitsLayer).bindPopup(f.properties.name);
      m.feature = f;
      m.on('click', ()=> chooseExit(m, f));
    });
  }

  loadExits();

  // graph grid for routing (nodes + edges)
  const nodes = [];
  const edges = [];
  const rows = 9, cols = 9;
  const cellDeg = 0.0011; // approx cell size
  (function buildGrid(){
    const lat0 = STAD.lat - (rows-1)/2*cellDeg;
    const lng0 = STAD.lng - (cols-1)/2*cellDeg;
    let id=0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const lat = lat0 + r*cellDeg;
        const lng = lng0 + c*cellDeg;
        nodes.push({id:id, lat, lng});
        id++;
      }
    }
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const i = r*cols + c;
        [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].forEach(rc=>{
          const rr=rc[0], cc=rc[1];
          if(rr>=0 && rr<rows && cc>=0 && cc<cols){
            const j = rr*cols + cc;
            edges.push({u:i, v:j, w: distance(nodes[i], nodes[j])});
          }
        });
      }
    }
  })();

  // utility distance (meters)
  function distance(a,b){
    const R=6371000, toRad=x=>x*Math.PI/180;
    const dLat = toRad(b.lat-a.lat), dLon = toRad(b.lng-a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const aa = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2*R*Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  }

  // crowd cluster simulation state
  let clusters = [];
  let simRunning = false;
  let simInterval = null;

  function spawnClusters(n){
    clusters = [];
    for(let i=0;i<n;i++){
      const ang = Math.random()*Math.PI*2;
      const dist = 0.0003 + Math.random()*0.0012;
      const lat = STAD.lat + Math.cos(ang)*dist;
      const lng = STAD.lng + Math.sin(ang)*dist;
      const size = 15 + Math.random()*160;
      const dir = Math.random()*360;
      const speed = 0.2 + Math.random()*1.4;
      clusters.push({lat,lng,size,dir,speed});
    }
    drawClusters();
  }

  function drawClusters(){
    clustersLayer.clearLayers();
    riskZones.innerHTML='';
    clusters.forEach((c,i)=>{
      const score = computeRiskAt(c.lat, c.lng);
      const col = score<30? '#31c46f' : score<60? '#ffb84a' : '#ff3850';
      L.circle([c.lat,c.lng], {radius: Math.max(30, c.size*6), color:col, fillOpacity:0.2}).addTo(clustersLayer);
      const li = document.createElement('li');
      li.innerHTML = `<strong>Zone ${i+1}</strong>: Risk ${score}% — size ${Math.round(c.size)}`;
      riskZones.appendChild(li);
    });
    clusterCount.innerText = clusters.length;
  }

  function computeRiskAt(lat,lng){
    let s=0;
    clusters.forEach(cl=>{
      const d = distance({lat,lng},{lat:cl.lat,lng:cl.lng});
      const influence = Math.max(0, 1 - d / (cl.size*60 + 1));
      const velRisk = Math.min(1, cl.speed/2);
      const chaos = Math.random()*0.2; // simulated direction uniformity penalty
      s += influence * (0.5 + 0.5*velRisk + chaos) * (cl.size/25);
    });
    return Math.min(100, Math.round(s*18));
  }

  // risk-aware Dijkstra
  function safestPath(startLatLng, destLatLng){
    // find nearest nodes
    function nearest(pt){
      let best=null, bd=1e12;
      nodes.forEach(n=>{ const d = distance(pt, n); if(d<bd){ bd=d; best=n; } });
      return best;
    }
    const s = nearest(startLatLng), t = nearest(destLatLng);
    if(!s || !t) return null;

    const N = nodes.length;
    const adj = Array.from({length:N}, ()=>[]);
    edges.forEach(e=>{
      const midLat = (nodes[e.u].lat + nodes[e.v].lat)/2;
      const midLng = (nodes[e.u].lng + nodes[e.v].lng)/2;
      const risk = computeRiskAt(midLat, midLng)/100;
      const w = e.w * (1 + 4*risk); // risk multiplier
      adj[e.u].push({v:e.v,w});
    });

    const distArr = new Array(N).fill(1e18);
    const prev = new Array(N).fill(-1);
    const vis = new Array(N).fill(false);
    distArr[s.id] = 0;
    for(let it=0; it<N; it++){
      let u=-1, best=1e18;
      for(let i=0;i<N;i++) if(!vis[i] && distArr[i]<best){ best=distArr[i]; u=i; }
      if(u==-1) break;
      vis[u]=true;
      adj[u].forEach(edge=>{
        if(distArr[edge.v] > distArr[u] + edge.w){
          distArr[edge.v] = distArr[u] + edge.w;
          prev[edge.v] = u;
        }
      });
    }
    if(prev[t.id]===-1) return null;
    const path = []; let cur = t.id;
    while(cur!==-1){ path.push(nodes[cur]); cur = prev[cur]; }
    path.reverse();
    const risks = path.map(p=> computeRiskAt(p.lat, p.lng));
    const avg = Math.round(risks.reduce((a,b)=>a+b,0)/risks.length || 0);
    return {path, avg, risks};
  }

  // draw route
  function drawRoute(obj){
    routeLayer.clearLayers();
    if(!obj) return;
    const latlngs = obj.path.map(n=>[n.lat,n.lng]);
    
    // Always draw the safest route in green with enhanced styling
    const col = '#31c46f'; // Green color for safest route
    L.polyline(latlngs, {
      color: col, 
      weight: 8, 
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);
    
    // Add a shadow effect for better visibility
    L.polyline(latlngs, {
      color: '#000000', 
      weight: 10, 
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);
    
    // Add start and end markers
    if(latlngs.length > 0) {
      L.circleMarker(latlngs[0], {radius:8, color:'#31c46f', fillOpacity:0.9}).addTo(routeLayer).bindPopup('Start');
      L.circleMarker(latlngs[latlngs.length-1], {radius:8, color:'#ff3850', fillOpacity:0.9}).addTo(routeLayer).bindPopup('Destination');
      
      // Add directional arrows along the route
      for(let i = 0; i < latlngs.length - 1; i += 2) {
        const start = latlngs[i];
        const end = latlngs[i + 1];
        const midLat = (start[0] + end[0]) / 2;
        const midLng = (start[1] + end[1]) / 2;
        
        // Calculate bearing for arrow direction
        const bearing = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        
        L.marker([midLat, midLng], {
          icon: L.divIcon({
            className: 'route-arrow',
            html: '→',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          }),
          rotationAngle: bearing
        }).addTo(routeLayer);
      }
    }
    
    // Calculate total distance
    let totalDistance = 0;
    for(let i = 0; i < obj.path.length - 1; i++) {
      totalDistance += distance(obj.path[i], obj.path[i+1]);
    }
    
    // Calculate time (assuming average walking speed of 1.4 m/s)
    const walkingSpeed = 1.4; // meters per second
    const timeInSeconds = totalDistance / walkingSpeed;
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.round(timeInSeconds % 60);
    
    // Update UI with route information
    routeRisk.innerText = obj.avg + '%';
    routeRisk.style.background = col;
    routeRisk.style.padding = '6px 8px';
    
    // Update route info display
    const routeInfo = document.getElementById('routeInfo');
    if(routeInfo) {
      routeInfo.innerHTML = `
        <div><strong>Total Distance:</strong> ${totalDistance.toFixed(1)}m</div>
        <div><strong>Time to Walk:</strong> ${minutes}m ${seconds}s</div>
        <div><strong>Route Risk:</strong> ${obj.avg}%</div>
      `;
    }
  }

  // start/dest markers
  let startMarker = null, destMarker = null;
  let nextSet = 'start';
  map.on('click', e=>{
    if(nextSet==='start'){
      if(startMarker) startMarker.remove();
      startMarker = L.marker(e.latlng, {draggable:true}).addTo(map).bindPopup('Start').openPopup();
      startInfo.innerText = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      startMarker.on('dragend', ()=> startInfo.innerText = `${startMarker.getLatLng().lat.toFixed(6)}, ${startMarker.getLatLng().lng.toFixed(6)}`);
      nextSet = 'dest';
    } else {
      if(destMarker) destMarker.remove();
      destMarker = L.marker(e.latlng, {draggable:true, icon:L.icon({iconUrl:'https://cdn-icons-png.flaticon.com/512/684/684908.png', iconSize:[28,28]})}).addTo(map).bindPopup('Destination').openPopup();
      destInfo.innerText = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      destMarker.on('dragend', ()=> destInfo.innerText = `${destMarker.getLatLng().lat.toFixed(6)}, ${destMarker.getLatLng().lng.toFixed(6)}`);
      nextSet = 'start';
    }
  });

  // choose exit handler when clicking exit marker
  function chooseExit(marker, feature){
    // treat exit click as destination
    if(destMarker) destMarker.remove();
    const latlng = marker.getLatLng();
    destMarker = L.marker(latlng, {draggable:true, icon:L.icon({iconUrl:'https://cdn-icons-png.flaticon.com/512/684/684908.png', iconSize:[28,28]})}).addTo(map).bindPopup(feature.properties.name).openPopup();
    destInfo.innerText = feature.properties.name;
    // auto compute if start exists
    if(startMarker) {
      const route = safestPath(startMarker.getLatLng(), destMarker.getLatLng());
      drawRoute(route);
      if(route && route.avg>60) triggerAlert('High risk route detected — avoid!');
    }
  }

  // compute route manual button
  computeRouteBtn.addEventListener('click', ()=>{
    if(!startMarker || !destMarker){ alert('Set start and destination (click map).'); return; }
    const route = safestPath(startMarker.getLatLng(), destMarker.getLatLng());
    drawRoute(route);
    if(route && route.avg>60) triggerAlert('High risk route detected — avoid!');
  });

  // drone warning
  droneWarn.addEventListener('click', ()=> triggerAlert('Drone warning: move to safer routes'));

  function triggerAlert(msg){
    lastAlert.innerText = msg;
    // popup near stadium
    const p = L.popup({closeButton:false, autoClose:true, className:'alertPopup'}).setLatLng([STAD.lat + 0.0008, STAD.lng]).setContent('<strong>ALERT</strong><div>'+msg+'</div>').openOn(map);
    try{ const s = new SpeechSynthesisUtterance(msg); speechSynthesis.speak(s); }catch(e){}
    setTimeout(()=> map.closePopup(p), 4500);
  }

  // demo points
  setDemo.addEventListener('click', ()=>{
    if(startMarker) startMarker.remove(); if(destMarker) destMarker.remove();
    startMarker = L.marker([STAD.lat + 0.0009, STAD.lng - 0.0009], {draggable:true}).addTo(map).bindPopup('Start').openPopup();
    destMarker = L.marker([STAD.lat - 0.0009, STAD.lng + 0.0009], {draggable:true, icon:L.icon({iconUrl:'https://cdn-icons-png.flaticon.com/512/684/684908.png', iconSize:[28,28]})}).addTo(map).bindPopup('Destination').openPopup();
    startInfo.innerText = `${(STAD.lat + 0.0009).toFixed(6)}, ${(STAD.lng - 0.0009).toFixed(6)}`;
    destInfo.innerText = `${(STAD.lat - 0.0009).toFixed(6)}, ${(STAD.lng + 0.0009).toFixed(6)}`;
  });

  // simulation toggle
  toggleSim.addEventListener('click', ()=>{
    simRunning = !simRunning;
    if(simRunning){ toggleSim.innerText = 'Stop Simulation'; modeLabel.innerText = 'Simulated live feed'; spawnClusters(4 + Math.floor(Math.random()*3)); simInterval = setInterval(()=>{ updateClusters(); }, 2000); }
    else { toggleSim.innerText = 'Start Simulation'; modeLabel.innerText='Demo (simulated)'; clearInterval(simInterval); clustersLayer.clearLayers(); clusters=[]; drawClusters(); clusterCount.innerText=0; }
  });

  function spawnClusters(n){
    clusters = [];
    for(let i=0;i<n;i++){
      const ang = Math.random()*Math.PI*2;
      const dist = 0.0003 + Math.random()*0.0012;
      const lat = STAD.lat + Math.cos(ang)*dist;
      const lng = STAD.lng + Math.sin(ang)*dist;
      const size = 10 + Math.random()*140;
      const dir = Math.random()*360;
      const speed = 0.2 + Math.random()*1.6;
      clusters.push({lat,lng,size,dir,speed});
    }
    drawClusters();
  }

  function updateClusters(){
    clusters.forEach(c=>{
      const r = c.speed * 0.00002;
      c.lat += Math.cos(c.dir*Math.PI/180) * r;
      c.lng += Math.sin(c.dir*Math.PI/180) * r;
      if(Math.random()<0.12){ c.dir += (Math.random()-0.5)*60; c.speed = Math.max(0.1, c.speed + (Math.random()-0.5)); }
      if(Math.random()<0.08){ c.size = Math.max(8, c.size + (Math.random()-0.5)*30); }
    });
    drawClusters();
    // auto reroute if start/dest exist
    if(startMarker && destMarker){
      const route = safestPath(startMarker.getLatLng(), destMarker.getLatLng());
      drawRoute(route);
    }
  }

  // initial spawn for visibility
  spawnClusters(4);

  // optional debug: draw grid nodes
  nodes.forEach(n=> L.circleMarker([n.lat,n.lng], {radius:2, color:'rgba(255,255,255,0.08)'}).addTo(debugLayer));

  // Green Commute Challenges System
  let userStats = {
    greenPoints: 0,
    co2Saved: 0,
    totalDistance: 0,
    challenges: {
      'no-car-week': { joined: false, progress: 0, target: 7, type: 'days' },
      'walk-10km': { joined: false, progress: 0, target: 10, type: 'km' },
      'cycle-friday': { joined: false, progress: 0, target: 4, type: 'fridays' }
    },
    achievements: {
      'first-steps': { unlocked: false, requirement: 1, type: 'km' },
      'wheel-deal': { unlocked: false, requirement: 5, type: 'km' },
      'eco-hero': { unlocked: false, requirement: 10, type: 'co2' }
    }
  };

  // Initialize challenge system
  function initChallengeSystem() {
    // Load saved data from localStorage
    const saved = localStorage.getItem('greenCommuteData');
    if (saved) {
      userStats = { ...userStats, ...JSON.parse(saved) };
    }
    
    updateUI();
    setupChallengeEventListeners();
  }

  function setupChallengeEventListeners() {
    document.querySelectorAll('.join-challenge').forEach(button => {
      button.addEventListener('click', (e) => {
        const card = e.target.closest('.challenge-card');
        const challengeId = card.dataset.challenge;
        joinChallenge(challengeId);
      });
    });
  }

  function joinChallenge(challengeId) {
    if (userStats.challenges[challengeId].joined) return;
    
    userStats.challenges[challengeId].joined = true;
    updateUI();
    saveData();
    
    // Show success message
    showNotification(`Joined ${getChallengeName(challengeId)}! 🎉`);
  }

  function getChallengeName(challengeId) {
    const names = {
      'no-car-week': 'No Car Week',
      'walk-10km': 'Walk 10km Challenge',
      'cycle-friday': 'Cycle to Office Friday'
    };
    return names[challengeId] || 'Challenge';
  }

  function addActivity(type, distance, co2Saved = 0) {
    userStats.totalDistance += distance;
    userStats.co2Saved += co2Saved;
    
    // Calculate points based on activity
    let points = 0;
    switch(type) {
      case 'walk':
        points = Math.round(distance * 10); // 10 points per km
        break;
      case 'cycle':
        points = Math.round(distance * 15); // 15 points per km
        break;
      case 'public_transport':
        points = Math.round(distance * 8); // 8 points per km
        break;
    }
    
    userStats.greenPoints += points;
    
    // Update challenge progress
    updateChallengeProgress(type, distance);
    
    // Check achievements
    checkAchievements();
    
    updateUI();
    saveData();
    
    showNotification(`+${points} Green Points! 🌱`);
  }

  function updateChallengeProgress(type, distance) {
    Object.keys(userStats.challenges).forEach(challengeId => {
      const challenge = userStats.challenges[challengeId];
      if (!challenge.joined) return;
      
      switch(challengeId) {
        case 'no-car-week':
          if (type === 'walk' || type === 'cycle' || type === 'public_transport') {
            challenge.progress = Math.min(challenge.target, challenge.progress + 1);
          }
          break;
        case 'walk-10km':
          if (type === 'walk') {
            challenge.progress = Math.min(challenge.target, challenge.progress + distance);
          }
          break;
        case 'cycle-friday':
          if (type === 'cycle') {
            challenge.progress = Math.min(challenge.target, challenge.progress + 1);
          }
          break;
      }
    });
  }

  function checkAchievements() {
    // First Steps: Walk 1km
    if (userStats.totalDistance >= 1 && !userStats.achievements['first-steps'].unlocked) {
      userStats.achievements['first-steps'].unlocked = true;
      showAchievement('First Steps', '🌱');
    }
    
    // Wheel Deal: Cycle 5km
    if (userStats.totalDistance >= 5 && !userStats.achievements['wheel-deal'].unlocked) {
      userStats.achievements['wheel-deal'].unlocked = true;
      showAchievement('Wheel Deal', '🚴‍♂️');
    }
    
    // Eco Hero: Save 10kg CO₂
    if (userStats.co2Saved >= 10 && !userStats.achievements['eco-hero'].unlocked) {
      userStats.achievements['eco-hero'].unlocked = true;
      showAchievement('Eco Hero', '🌍');
    }
  }

  function updateUI() {
    // Update stats
    document.getElementById('co2Saved').textContent = `${userStats.co2Saved.toFixed(1)} kg`;
    document.getElementById('greenPoints').textContent = userStats.greenPoints.toLocaleString();
    document.getElementById('activeUsers').textContent = Math.floor(Math.random() * 1000) + 500; // Simulated
    
    // Update challenge progress
    Object.keys(userStats.challenges).forEach(challengeId => {
      const challenge = userStats.challenges[challengeId];
      const card = document.querySelector(`[data-challenge="${challengeId}"]`);
      if (!card) return;
      
      const progressFill = card.querySelector('.progress-fill');
      const progressText = card.querySelector('.progress-text');
      const joinButton = card.querySelector('.join-challenge');
      
      if (challenge.joined) {
        const percentage = (challenge.progress / challenge.target) * 100;
        progressFill.style.width = `${percentage}%`;
        
        if (challenge.type === 'days') {
          progressText.textContent = `${challenge.progress}/${challenge.target} days`;
        } else if (challenge.type === 'km') {
          progressText.textContent = `${challenge.progress.toFixed(1)}/${challenge.target} km`;
        } else if (challenge.type === 'fridays') {
          progressText.textContent = `${challenge.progress}/${challenge.target} Fridays`;
        }
        
        joinButton.textContent = challenge.progress >= challenge.target ? 'Completed! 🎉' : 'In Progress';
        joinButton.disabled = true;
        joinButton.style.opacity = '0.7';
      }
    });
    
    // Update achievements
    Object.keys(userStats.achievements).forEach(achievementId => {
      const achievement = userStats.achievements[achievementId];
      const achievementEl = document.querySelector(`[data-achievement="${achievementId}"]`);
      if (!achievementEl) return;
      
      if (achievement.unlocked) {
        achievementEl.classList.remove('locked');
        achievementEl.classList.add('unlocked');
      }
    });
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(90deg, #31c46f, #3ddc97);
      color: #042129;
      padding: 12px 20px;
      border-radius: 25px;
      font-weight: 600;
      font-size: 14px;
      z-index: 1000;
      box-shadow: 0 4px 15px rgba(49,196,111,0.3);
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function showAchievement(name, icon) {
    const achievement = document.createElement('div');
    achievement.className = 'achievement-popup';
    achievement.innerHTML = `
      <div class="achievement-content">
        <div class="achievement-icon">${icon}</div>
        <div class="achievement-text">
          <h3>Achievement Unlocked!</h3>
          <p>${name}</p>
        </div>
      </div>
    `;
    achievement.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, rgba(49,196,111,0.95), rgba(61,220,151,0.95));
      color: #042129;
      padding: 20px;
      border-radius: 15px;
      z-index: 1001;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      animation: achievementPop 0.5s ease;
      text-align: center;
    `;
    
    document.body.appendChild(achievement);
    
    setTimeout(() => {
      achievement.style.animation = 'achievementFade 0.5s ease';
      setTimeout(() => achievement.remove(), 500);
    }, 3000);
  }

  function saveData() {
    localStorage.setItem('greenCommuteData', JSON.stringify(userStats));
  }

  // Simulate some activity for demo purposes
  function simulateActivity() {
    const activities = ['walk', 'cycle', 'public_transport'];
    const activity = activities[Math.floor(Math.random() * activities.length)];
    const distance = 0.5 + Math.random() * 2; // 0.5-2.5 km
    const co2Saved = distance * 0.2; // Rough estimate: 0.2kg CO₂ per km
    
    addActivity(activity, distance, co2Saved);
  }

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    @keyframes achievementPop {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
      50% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    @keyframes achievementFade {
      from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      to { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
    }
    .achievement-content {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .achievement-content .achievement-icon {
      font-size: 32px;
    }
    .achievement-content h3 {
      margin: 0 0 5px 0;
      font-size: 18px;
    }
    .achievement-content p {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  // Crowd-Aware Flow Optimization System
  let crowdData = {
    zones: {
      north: { density: 0, count: 0, status: 'low' },
      east: { density: 0, count: 0, status: 'low' },
      south: { density: 0, count: 0, status: 'low' },
      west: { density: 0, count: 0, status: 'low' }
    },
    suggestions: [],
    signalStatus: 'normal'
  };

  let parkingData = {
    zones: {
      A: { capacity: 30, total: 100, status: 'available', distance: 0.2 },
      B: { capacity: 65, total: 100, status: 'moderate', distance: 0.4 },
      C: { capacity: 100, total: 100, status: 'full', distance: 0.6 }
    },
    currentDemand: 65,
    predictedDemand: 78,
    availableSpots: 127
  };

  function initCrowdMonitoring() {
    updateCrowdDensity();
    updateParkingData();
    setupCrowdEventListeners();
    
    // Update crowd data every 5 seconds
    setInterval(updateCrowdDensity, 5000);
    setInterval(updateParkingData, 10000);
  }

  function setupCrowdEventListeners() {
    // Traffic light controls
    document.getElementById('optimizeTiming').addEventListener('click', optimizeTrafficTiming);
    document.getElementById('emergencyMode').addEventListener('click', activateEmergencyMode);
    
    // Parking guidance
    document.getElementById('findParking').addEventListener('click', findBestParking);
    document.getElementById('reserveSpot').addEventListener('click', reserveParkingSpot);
  }

  function updateCrowdDensity() {
    Object.keys(crowdData.zones).forEach(zone => {
      // Simulate computer vision data
      const baseCount = Math.random() * 50 + 10;
      const timeFactor = getTimeFactor();
      const eventFactor = getEventFactor();
      const count = Math.round(baseCount * timeFactor * eventFactor);
      
      const density = Math.min(100, (count / 50) * 100);
      const status = density < 30 ? 'low' : density < 70 ? 'high' : 'critical';
      
      crowdData.zones[zone] = { density, count, status };
      
      // Update UI
      updateZoneDisplay(zone, density, count, status);
    });
    
    // Generate smart suggestions based on crowd data
    generateSmartSuggestions();
  }

  function getTimeFactor() {
    const hour = new Date().getHours();
    if (hour >= 7 && hour <= 9) return 1.5; // Morning rush
    if (hour >= 17 && hour <= 19) return 1.8; // Evening rush
    if (hour >= 12 && hour <= 14) return 1.2; // Lunch time
    return 0.8; // Off-peak
  }

  function getEventFactor() {
    // Simulate event impact
    const events = [1.0, 1.2, 1.5, 2.0];
    return events[Math.floor(Math.random() * events.length)];
  }

  function updateZoneDisplay(zone, density, count, status) {
    const densityFill = document.getElementById(`${zone}Density`);
    const densityText = document.getElementById(`${zone}Text`);
    const crowdCount = document.getElementById(`${zone}Count`);
    
    if (densityFill && densityText && crowdCount) {
      densityFill.style.width = `${density}%`;
      densityFill.className = `density-fill ${status}`;
      
      densityText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      crowdCount.textContent = `${count} people`;
    }
  }

  function generateSmartSuggestions() {
    const suggestions = [];
    const zones = Object.entries(crowdData.zones);
    
    // Find zones with high density
    const highDensityZones = zones.filter(([_, data]) => data.status === 'high' || data.status === 'critical');
    
    if (highDensityZones.length > 0) {
      highDensityZones.forEach(([zone, data]) => {
        suggestions.push({
          icon: '⚠️',
          text: `Avoid ${zone.charAt(0).toUpperCase() + zone.slice(1)} Gate - High congestion (${data.count} people)`
        });
      });
    }
    
    // Find best alternative routes
    const lowDensityZones = zones.filter(([_, data]) => data.status === 'low');
    if (lowDensityZones.length > 0) {
      const bestZone = lowDensityZones[0];
      suggestions.push({
        icon: '✅',
        text: `Use ${bestZone[0].charAt(0).toUpperCase() + bestZone[0].slice(1)} Gate - Low congestion (${bestZone[1].count} people)`
      });
    }
    
    // Add timing suggestions
    const avgDensity = zones.reduce((sum, [_, data]) => sum + data.density, 0) / zones.length;
    if (avgDensity > 60) {
      suggestions.push({
        icon: '⏰',
        text: 'Consider waiting 10-15 minutes for crowd to disperse'
      });
    }
    
    updateSuggestionsDisplay(suggestions);
  }

  function updateSuggestionsDisplay(suggestions) {
    const suggestionList = document.getElementById('suggestionList');
    if (!suggestionList) return;
    
    suggestionList.innerHTML = '';
    
    if (suggestions.length === 0) {
      suggestionList.innerHTML = `
        <div class="suggestion-item">
          <div class="suggestion-icon">✅</div>
          <div class="suggestion-text">All paths currently optimal</div>
        </div>
      `;
      return;
    }
    
    suggestions.forEach(suggestion => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `
        <div class="suggestion-icon">${suggestion.icon}</div>
        <div class="suggestion-text">${suggestion.text}</div>
      `;
      suggestionList.appendChild(item);
    });
  }

  function optimizeTrafficTiming() {
    const button = document.getElementById('optimizeTiming');
    const status = document.getElementById('signalStatus');
    
    button.textContent = 'Optimizing...';
    button.disabled = true;
    
    setTimeout(() => {
      button.textContent = 'Optimize Timing';
      button.disabled = false;
      
      status.innerHTML = `
        <div class="status-indicator yellow"></div>
        <span>Timing Optimized - Reduced wait times by 23%</span>
      `;
      
      showNotification('Traffic timing optimized! 🚦');
    }, 2000);
  }

  function activateEmergencyMode() {
    const status = document.getElementById('signalStatus');
    crowdData.signalStatus = 'emergency';
    
    status.innerHTML = `
      <div class="status-indicator red"></div>
      <span>Emergency Mode - All signals on green for evacuation</span>
    `;
    
    showNotification('Emergency mode activated! 🚨');
    
    // Auto-disable after 5 minutes
    setTimeout(() => {
      crowdData.signalStatus = 'normal';
      status.innerHTML = `
        <div class="status-indicator green"></div>
        <span>Normal Operation</span>
      `;
    }, 300000);
  }

  function updateParkingData() {
    // Simulate AI prediction updates
    const timeFactor = getTimeFactor();
    const randomFactor = 0.8 + Math.random() * 0.4;
    
    parkingData.currentDemand = Math.round(60 + Math.random() * 30);
    parkingData.predictedDemand = Math.round(parkingData.currentDemand * timeFactor * randomFactor);
    
    // Update zone capacities
    Object.keys(parkingData.zones).forEach(zone => {
      const baseCapacity = parkingData.zones[zone].total;
      const variation = Math.random() * 20 - 10;
      const newCapacity = Math.max(0, Math.min(baseCapacity, baseCapacity * 0.3 + variation));
      
      parkingData.zones[zone].capacity = Math.round(newCapacity);
      
      if (newCapacity < baseCapacity * 0.3) {
        parkingData.zones[zone].status = 'available';
      } else if (newCapacity < baseCapacity * 0.8) {
        parkingData.zones[zone].status = 'moderate';
      } else {
        parkingData.zones[zone].status = 'full';
      }
    });
    
    // Calculate total available spots
    parkingData.availableSpots = Object.values(parkingData.zones)
      .reduce((sum, zone) => sum + (zone.total - zone.capacity), 0);
    
    updateParkingDisplay();
  }

  function updateParkingDisplay() {
    // Update prediction stats
    document.getElementById('currentDemand').textContent = `${parkingData.currentDemand}%`;
    document.getElementById('predictedDemand').textContent = `${parkingData.predictedDemand}%`;
    document.getElementById('availableSpots').textContent = parkingData.availableSpots;
    
    // Update zone displays
    Object.entries(parkingData.zones).forEach(([zone, data]) => {
      const capacityFill = document.getElementById(`zone${zone}Capacity`);
      const zoneElement = document.querySelector(`[data-zone="${zone}"]`);
      
      if (capacityFill && zoneElement) {
        const percentage = (data.capacity / data.total) * 100;
        capacityFill.style.width = `${percentage}%`;
        capacityFill.className = `capacity-fill ${data.status}`;
        
        // Update status text
        const statusElement = zoneElement.querySelector('.zone-status');
        const capacityText = zoneElement.querySelector('.capacity-text');
        
        if (statusElement) {
          statusElement.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
          statusElement.className = `zone-status ${data.status}`;
        }
        
        if (capacityText) {
          capacityText.textContent = `${data.capacity}/${data.total} spots`;
        }
      }
    });
    
    // Update guidance message
    updateParkingGuidance();
  }

  function updateParkingGuidance() {
    const bestZone = Object.entries(parkingData.zones)
      .filter(([_, data]) => data.status === 'available')
      .sort((a, b) => a[1].distance - b[1].distance)[0];
    
    const guidanceMessage = document.getElementById('guidanceMessage');
    if (guidanceMessage && bestZone) {
      guidanceMessage.innerHTML = `
        <div class="guidance-icon">🎯</div>
        <div class="guidance-text">Head to Zone ${bestZone[0]} for best availability (${bestZone[1].total - bestZone[1].capacity} spots)</div>
      `;
    } else {
      guidanceMessage.innerHTML = `
        <div class="guidance-icon">⚠️</div>
        <div class="guidance-text">All zones busy - Consider alternative transport</div>
      `;
    }
  }

  function findBestParking() {
    const bestZone = Object.entries(parkingData.zones)
      .filter(([_, data]) => data.status === 'available')
      .sort((a, b) => a[1].distance - b[1].distance)[0];
    
    if (bestZone) {
      showNotification(`Best parking: Zone ${bestZone[0]} (${bestZone[1].total - bestZone[1].capacity} spots available) 🅿️`);
      
      // Highlight the zone on the map (simulated)
      const zoneElement = document.querySelector(`[data-zone="${bestZone[0]}"]`);
      if (zoneElement) {
        zoneElement.style.background = 'rgba(49,196,111,0.2)';
        zoneElement.style.borderColor = 'rgba(49,196,111,0.5)';
        
        setTimeout(() => {
          zoneElement.style.background = '';
          zoneElement.style.borderColor = '';
        }, 3000);
      }
    } else {
      showNotification('No available parking spots found. Consider alternative transport. 🚌');
    }
  }

  function reserveParkingSpot() {
    const availableZone = Object.entries(parkingData.zones)
      .find(([_, data]) => data.status === 'available');
    
    if (availableZone) {
      showNotification(`Parking spot reserved in Zone ${availableZone[0]}! Valid for 15 minutes. 🎫`);
      
      // Simulate reservation
      availableZone[1].capacity += 1;
      updateParkingDisplay();
    } else {
      showNotification('No spots available for reservation. Try again later. ❌');
    }
  }

  // Tab Navigation System
  function initTabNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        
        // Remove active class from all tabs and contents
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(tc => tc.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        tab.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
        
        // Update activity log
        addActivityLog(`Switched to ${tab.textContent} dashboard`);
      });
    });
    
    // Quick action buttons
    document.getElementById('quickRoute').addEventListener('click', () => {
      document.querySelector('[data-tab="routing"]').click();
    });
    
    document.getElementById('quickParking').addEventListener('click', () => {
      document.querySelector('[data-tab="parking"]').click();
    });
    
    document.getElementById('quickCrowd').addEventListener('click', () => {
      document.querySelector('[data-tab="crowd"]').click();
    });
    
    document.getElementById('quickEmergency').addEventListener('click', () => {
      document.querySelector('[data-tab="crowd"]').click();
      setTimeout(() => {
        document.getElementById('emergencyMode').click();
      }, 100);
    });
  }

  // Activity Log System
  function addActivityLog(message) {
    const activityList = document.getElementById('activityList');
    if (!activityList) return;
    
    const activityItem = document.createElement('div');
    activityItem.className = 'activity-item';
    activityItem.innerHTML = `
      <div class="activity-icon">📝</div>
      <div class="activity-text">${message}</div>
      <div class="activity-time">Just now</div>
    `;
    
    // Add to top of list
    activityList.insertBefore(activityItem, activityList.firstChild);
    
    // Keep only last 5 items
    while (activityList.children.length > 5) {
      activityList.removeChild(activityList.lastChild);
    }
  }

  // Update Overview Dashboard
  function updateOverviewDashboard() {
    // Update total crowd count
    const totalCrowd = Object.values(crowdData.zones).reduce((sum, zone) => sum + zone.count, 0);
    document.getElementById('totalCrowd').textContent = totalCrowd;
    
    // Update available parking
    document.getElementById('availableParking').textContent = parkingData.availableSpots;
    
    // Update alerts count
    const alertsCount = Object.values(crowdData.zones).filter(zone => zone.status === 'critical').length;
    document.getElementById('alertsCount').textContent = alertsCount;
    
    // Update green points
    document.getElementById('greenPoints').textContent = userStats.greenPoints.toLocaleString();
  }

  // Enhanced Route Display
  function updateRouteDisplay(route) {
    if (!route) return;
    
    // Update route metrics
    document.getElementById('routeRisk').textContent = route.avg + '%';
    document.getElementById('routeDistance').textContent = route.totalDistance ? route.totalDistance.toFixed(1) + 'm' : '—';
    document.getElementById('routeTime').textContent = route.time ? route.time : '—';
    
    // Update route visualization
    const routePath = document.getElementById('routePath');
    if (routePath) {
      routePath.style.display = 'block';
    }
  }

  // Accessibility and Safety System
  let accessibilityOptions = {
    wheelchairAccess: true,
    visualImpairment: true,
    mobilityAid: true,
    avoidStairs: true
  };

  let dangerousRoutes = [
    {
      id: 'construction-north',
      location: 'Construction Zone - North Gate',
      reason: 'Heavy machinery, uneven surfaces',
      severity: 'high',
      coordinates: [12.9805, 77.5995],
      radius: 50
    },
    {
      id: 'flooding-east',
      location: 'Flooded Area - East Gate',
      reason: 'Water accumulation, slippery surfaces',
      severity: 'medium',
      coordinates: [12.9788, 77.6010],
      radius: 30
    },
    {
      id: 'narrow-passage',
      location: 'Narrow Passage - South Gate',
      reason: 'Limited width, difficult for wheelchairs',
      severity: 'low',
      coordinates: [12.9775, 77.5995],
      radius: 25
    }
  ];

  let heatmapData = [];
  let heatmapVisible = false;

  // Initialize accessibility and safety features
  function initAccessibilitySafety() {
    setupAccessibilityOptions();
    setupHeatmapControls();
    generateHeatmapData();
    updateDangerousRoutes();
    addActivityLog('Accessibility and safety features initialized');
  }

  function setupAccessibilityOptions() {
    const checkboxes = document.querySelectorAll('.accessibility-option input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const option = e.target.id;
        accessibilityOptions[option] = e.target.checked;
        
        // Recompute route if start and destination are set
        if(startMarker && destMarker) {
          const route = safestPath(startMarker.getLatLng(), destMarker.getLatLng());
          drawRoute(route);
        }
        
        addActivityLog(`Accessibility option updated: ${option}`);
      });
    });
  }

  function setupHeatmapControls() {
    document.getElementById('toggleHeatmap').addEventListener('click', toggleHeatmap);
    document.getElementById('updateHeatmap').addEventListener('click', updateHeatmapData);
  }

  function generateHeatmapData() {
    heatmapData = [];
    const gridSize = 0.0005; // Grid resolution
    const bounds = map.getBounds();
    
    for(let lat = bounds.getSouth(); lat <= bounds.getNorth(); lat += gridSize) {
      for(let lng = bounds.getWest(); lng <= bounds.getEast(); lng += gridSize) {
        const risk = computeRiskAt(lat, lng);
        const accessibility = computeAccessibilityScore(lat, lng);
        
        heatmapData.push({
          lat: lat,
          lng: lng,
          risk: risk,
          accessibility: accessibility,
          combined: (risk + (100 - accessibility)) / 2
        });
      }
    }
  }

  function computeAccessibilityScore(lat, lng) {
    let score = 100; // Start with perfect accessibility
    
    // Check for stairs
    if(accessibilityOptions.avoidStairs) {
      const stairs = checkForStairs(lat, lng);
      if(stairs) score -= 40;
    }
    
    // Check for wheelchair accessibility
    if(accessibilityOptions.wheelchairAccess) {
      const wheelchair = checkWheelchairAccess(lat, lng);
      if(!wheelchair) score -= 30;
    }
    
    // Check for narrow passages
    const narrow = checkNarrowPassage(lat, lng);
    if(narrow) score -= 20;
    
    // Check for uneven surfaces
    const uneven = checkUnevenSurface(lat, lng);
    if(uneven) score -= 15;
    
    return Math.max(0, score);
  }

  function checkForStairs(lat, lng) {
    // Simulate stairs detection
    return Math.random() < 0.1; // 10% chance of stairs
  }

  function checkWheelchairAccess(lat, lng) {
    // Simulate wheelchair accessibility check
    return Math.random() < 0.8; // 80% accessible
  }

  function checkNarrowPassage(lat, lng) {
    // Simulate narrow passage detection
    return Math.random() < 0.15; // 15% chance of narrow passage
  }

  function checkUnevenSurface(lat, lng) {
    // Simulate uneven surface detection
    return Math.random() < 0.2; // 20% chance of uneven surface
  }

  function updateDangerousRoutes() {
    const dangerList = document.getElementById('dangerList');
    if(!dangerList) return;
    
    dangerList.innerHTML = '';
    
    dangerousRoutes.forEach(route => {
      const dangerItem = document.createElement('div');
      dangerItem.className = 'danger-item';
      dangerItem.innerHTML = `
        <div class="danger-icon">${getDangerIcon(route.severity)}</div>
        <div class="danger-info">
          <div class="danger-location">${route.location}</div>
          <div class="danger-reason">${route.reason}</div>
        </div>
        <div class="danger-severity ${route.severity}">${route.severity.charAt(0).toUpperCase() + route.severity.slice(1)} Risk</div>
      `;
      dangerList.appendChild(dangerItem);
    });
  }

  function getDangerIcon(severity) {
    const icons = {
      high: '🚧',
      medium: '⚠️',
      low: '🔸'
    };
    return icons[severity] || '⚠️';
  }

  function toggleHeatmap() {
    heatmapVisible = !heatmapVisible;
    const button = document.getElementById('toggleHeatmap');
    
    if(heatmapVisible) {
      button.textContent = 'Hide Heat Map';
      showHeatmap();
    } else {
      button.textContent = 'Show Heat Map';
      hideHeatmap();
    }
  }

  function showHeatmap() {
    // Clear existing heatmap
    hideHeatmap();
    
    // Create heatmap overlay
    const heatmapOverlay = L.layerGroup().addTo(map);
    heatmapOverlay._heatmapLayer = true; // Mark for easy removal
    
    heatmapData.forEach(point => {
      const color = getHeatmapColor(point.combined);
      const size = Math.max(8, Math.min(20, point.combined / 5));
      
      L.circleMarker([point.lat, point.lng], {
        radius: size,
        color: color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 1
      }).addTo(heatmapOverlay);
    });
    
    addActivityLog('Safety heat map displayed');
  }

  function hideHeatmap() {
    map.eachLayer(layer => {
      if(layer._heatmapLayer) {
        map.removeLayer(layer);
      }
    });
  }

  function getHeatmapColor(value) {
    if(value < 30) return '#31c46f'; // Green - Safe
    if(value < 60) return '#ffb84a'; // Yellow - Moderate
    return '#ff3850'; // Red - Dangerous
  }

  function updateHeatmapData() {
    generateHeatmapData();
    if(heatmapVisible) {
      showHeatmap();
    }
    addActivityLog('Heat map data updated');
  }

  // Enhanced safestPath function with accessibility support
  function safestPath(startLatLng, destLatLng){
    // Find nearest nodes
    function nearest(pt){
      let best=null, bd=1e12;
      nodes.forEach(n=>{ const d = distance(pt, n); if(d<bd){ bd=d; best=n; } });
      return best;
    }
    const s = nearest(startLatLng), t = nearest(destLatLng);
    if(!s || !t) return null;

    const N = nodes.length;
    const adj = Array.from({length:N}, ()=>[]);
    edges.forEach(e=>{
      const midLat = (nodes[e.u].lat + nodes[e.v].lat)/2;
      const midLng = (nodes[e.u].lng + nodes[e.v].lng)/2;
      const risk = computeRiskAt(midLat, midLng)/100;
      const accessibility = computeAccessibilityScore(midLat, midLng)/100;
      
      // Enhanced weight calculation with accessibility
      let accessibilityPenalty = 0;
      if(accessibilityOptions.wheelchairAccess && accessibility < 0.7) accessibilityPenalty += 2;
      if(accessibilityOptions.visualImpairment && accessibility < 0.8) accessibilityPenalty += 1;
      if(accessibilityOptions.mobilityAid && accessibility < 0.6) accessibilityPenalty += 1.5;
      if(accessibilityOptions.avoidStairs && checkForStairs(midLat, midLng)) accessibilityPenalty += 3;
      
      const w = e.w * (1 + 4*risk + accessibilityPenalty);
      adj[e.u].push({v:e.v,w});
    });

    const distArr = new Array(N).fill(1e18);
    const prev = new Array(N).fill(-1);
    const vis = new Array(N).fill(false);
    distArr[s.id] = 0;
    for(let it=0; it<N; it++){
      let u=-1, best=1e18;
      for(let i=0;i<N;i++) if(!vis[i] && distArr[i]<best){ best=distArr[i]; u=i; }
      if(u==-1) break;
      vis[u]=true;
      adj[u].forEach(edge=>{
        if(distArr[edge.v] > distArr[u] + edge.w){
          distArr[edge.v] = distArr[u] + edge.w;
          prev[edge.v] = u;
        }
      });
    }
    if(prev[t.id]===-1) return null;
    const path = []; let cur = t.id;
    while(cur!==-1){ path.push(nodes[cur]); cur = prev[cur]; }
    path.reverse();
    const risks = path.map(p=> computeRiskAt(p.lat, p.lng));
    const accessibilities = path.map(p=> computeAccessibilityScore(p.lat, p.lng));
    const avg = Math.round(risks.reduce((a,b)=>a+b,0)/risks.length || 0);
    const avgAccessibility = Math.round(accessibilities.reduce((a,b)=>a+b,0)/accessibilities.length || 0);
    return {path, avg, risks, avgAccessibility, accessibilities};
  }

  // Enhanced drawRoute function with accessibility and safety features
  function drawRoute(obj){
    routeLayer.clearLayers();
    if(!obj) return;
    const latlngs = obj.path.map(n=>[n.lat,n.lng]);
    
    // Check if route passes through dangerous areas
    const dangerousAreas = checkDangerousAreas(obj.path);
    
    // Choose route color based on safety and accessibility
    let col = '#31c46f'; // Default green
    if(obj.avg > 60) col = '#ff3850'; // Red for high risk
    else if(obj.avg > 30) col = '#ffb84a'; // Yellow for moderate risk
    
    if(dangerousAreas.length > 0) {
      col = '#ff1744'; // Dark red for dangerous areas
    }
    
    // Draw main route
    L.polyline(latlngs, {
      color: col, 
      weight: 8, 
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);
    
    // Add accessibility indicators
    if(accessibilityOptions.wheelchairAccess) {
      L.polyline(latlngs, {
        color: '#31c46f',
        weight: 3,
        opacity: 0.6,
        dashArray: '8,4'
      }).addTo(routeLayer);
    }
    
    // Add dangerous area warnings
    dangerousAreas.forEach(area => {
      L.circle([area.lat, area.lng], {
        radius: area.radius,
        color: '#ff3850',
        fillColor: '#ff3850',
        fillOpacity: 0.2,
        weight: 2,
        dashArray: '5,5'
      }).addTo(routeLayer).bindPopup(`⚠️ ${area.reason}`);
    });
    
    // Add a shadow effect for better visibility
    L.polyline(latlngs, {
      color: '#000000', 
      weight: 10, 
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);
    
    // Add start and end markers
    if(latlngs.length > 0) {
      L.circleMarker(latlngs[0], {radius:8, color:'#31c46f', fillOpacity:0.9}).addTo(routeLayer).bindPopup('Start');
      L.circleMarker(latlngs[latlngs.length-1], {radius:8, color:'#ff3850', fillOpacity:0.9}).addTo(routeLayer).bindPopup('Destination');
      
      // Add directional arrows along the route
      for(let i = 0; i < latlngs.length - 1; i += 2) {
        const start = latlngs[i];
        const end = latlngs[i + 1];
        const midLat = (start[0] + end[0]) / 2;
        const midLng = (start[1] + end[1]) / 2;
        
        // Calculate bearing for arrow direction
        const bearing = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        
        L.marker([midLat, midLng], {
          icon: L.divIcon({
            className: 'route-arrow',
            html: '→',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          }),
          rotationAngle: bearing
        }).addTo(routeLayer);
      }
    }
    
    // Calculate total distance
    let totalDistance = 0;
    for(let i = 0; i < obj.path.length - 1; i++) {
      totalDistance += distance(obj.path[i], obj.path[i+1]);
    }
    
    // Calculate time (assuming average walking speed of 1.4 m/s)
    const walkingSpeed = 1.4; // meters per second
    const timeInSeconds = totalDistance / walkingSpeed;
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.round(timeInSeconds % 60);
    
    // Store route data for display
    obj.totalDistance = totalDistance;
    obj.time = `${minutes}m ${seconds}s`;
    
    // Update route display
    updateRouteDisplay(obj);
    
    // Show accessibility and safety notifications
    if(obj.avgAccessibility < 70) {
      showNotification(`⚠️ Route has accessibility challenges (${obj.avgAccessibility}% accessible)`, 'warning');
    }
    
    if(dangerousAreas.length > 0) {
      showNotification(`🚨 Route passes through ${dangerousAreas.length} dangerous area(s)`, 'danger');
    }
    
    // Update activity log
    addActivityLog(`Route computed: ${totalDistance.toFixed(1)}m, ${minutes}m ${seconds}s, ${obj.avgAccessibility}% accessible`);
  }

  function checkDangerousAreas(path) {
    const dangerousAreas = [];
    
    path.forEach(point => {
      dangerousRoutes.forEach(route => {
        const dist = distance(point, {lat: route.coordinates[0], lng: route.coordinates[1]});
        if(dist < route.radius) {
          dangerousAreas.push({
            lat: route.coordinates[0],
            lng: route.coordinates[1],
            radius: route.radius,
            reason: route.reason
          });
        }
      });
    });
    
    return dangerousAreas;
  }

  // Enhanced notification system
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}-notification`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 25px;
      font-weight: 600;
      font-size: 14px;
      z-index: 1000;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `;
    
    if(type === 'warning') {
      notification.style.background = 'linear-gradient(90deg, #ffb84a, #ff8a65)';
      notification.style.color = '#042129';
    } else if(type === 'danger') {
      notification.style.background = 'linear-gradient(90deg, #ff3850, #ff1744)';
      notification.style.color = 'white';
    } else {
      notification.style.background = 'linear-gradient(90deg, #31c46f, #3ddc97)';
      notification.style.color = '#042129';
    }
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // Energy-Aware Smart Lighting System
  let lightingData = {
    zones: {
      north: { intensity: 75, mode: 'adaptive', energySaved: 0 },
      east: { intensity: 60, mode: 'energy_saving', energySaved: 0 },
      south: { intensity: 90, mode: 'high_density', energySaved: 0 },
      west: { intensity: 45, mode: 'low_density', energySaved: 0 }
    },
    totalEnergySaved: 24.5,
    totalCostSaved: 245,
    totalCO2Reduced: 12.3
  };

  function initEnergyLighting() {
    updateLightingDisplay();
    updateEnergyStats();
    addActivityLog('Energy-aware lighting system initialized');
    
    // Update lighting every 10 seconds
    setInterval(updateLightingSystem, 10000);
  }

  function updateLightingSystem() {
    // Simulate crowd-based lighting adjustments
    Object.keys(lightingData.zones).forEach(zone => {
      const crowdDensity = crowdData.zones[zone]?.density || 0;
      const currentIntensity = lightingData.zones[zone].intensity;
      
      // Adjust intensity based on crowd density
      let newIntensity = currentIntensity;
      let newMode = 'adaptive';
      
      if(crowdDensity > 80) {
        newIntensity = Math.min(100, currentIntensity + 5);
        newMode = 'high_density';
      } else if(crowdDensity > 50) {
        newIntensity = Math.min(90, currentIntensity + 2);
        newMode = 'moderate_density';
      } else if(crowdDensity < 20) {
        newIntensity = Math.max(30, currentIntensity - 3);
        newMode = 'energy_saving';
      } else {
        newMode = 'adaptive';
      }
      
      lightingData.zones[zone].intensity = newIntensity;
      lightingData.zones[zone].mode = newMode;
      
      // Calculate energy savings
      const energySaved = Math.max(0, 100 - newIntensity) * 0.1;
      lightingData.zones[zone].energySaved += energySaved;
    });
    
    updateLightingDisplay();
    updateEnergyStats();
  }

  function updateLightingDisplay() {
    Object.keys(lightingData.zones).forEach(zone => {
      const data = lightingData.zones[zone];
      
      // Update intensity bar
      const intensityBar = document.getElementById(`${zone}Intensity`);
      const intensityValue = document.getElementById(`${zone}Value`);
      const statusIndicator = document.getElementById(`${zone}Status`);
      const modeText = document.getElementById(`${zone}Mode`);
      
      if(intensityBar) {
        intensityBar.style.width = `${data.intensity}%`;
        intensityBar.style.background = getIntensityColor(data.intensity);
      }
      
      if(intensityValue) {
        intensityValue.textContent = `${data.intensity}%`;
      }
      
      if(statusIndicator) {
        statusIndicator.className = `status-indicator ${getStatusClass(data.mode)}`;
      }
      
      if(modeText) {
        modeText.textContent = getModeText(data.mode);
      }
    });
  }

  function getIntensityColor(intensity) {
    if(intensity > 80) return 'linear-gradient(90deg, #ff3850, #ff1744)';
    if(intensity > 60) return 'linear-gradient(90deg, #ffb84a, #ff8a65)';
    return 'linear-gradient(90deg, #31c46f, #3ddc97)';
  }

  function getStatusClass(mode) {
    const classes = {
      'high_density': 'red',
      'moderate_density': 'yellow',
      'adaptive': 'green',
      'energy_saving': 'blue',
      'low_density': 'blue'
    };
    return classes[mode] || 'green';
  }

  function getModeText(mode) {
    const texts = {
      'high_density': 'High Density',
      'moderate_density': 'Moderate',
      'adaptive': 'Adaptive Mode',
      'energy_saving': 'Energy Saving',
      'low_density': 'Low Density'
    };
    return texts[mode] || 'Adaptive';
  }

  function updateEnergyStats() {
    // Calculate total energy saved
    const totalEnergy = Object.values(lightingData.zones).reduce((sum, zone) => sum + zone.energySaved, 0);
    lightingData.totalEnergySaved = totalEnergy;
    lightingData.totalCostSaved = totalEnergy * 10; // ₹10 per kWh
    lightingData.totalCO2Reduced = totalEnergy * 0.5; // 0.5 kg CO2 per kWh
    
    // Update display
    const energySaved = document.getElementById('energySaved');
    const costSaved = document.getElementById('costSaved');
    const co2Reduced = document.getElementById('co2Reduced');
    
    if(energySaved) energySaved.textContent = `${totalEnergy.toFixed(1)} kWh`;
    if(costSaved) costSaved.textContent = `₹${lightingData.totalCostSaved.toFixed(0)}`;
    if(co2Reduced) co2Reduced.textContent = `${lightingData.totalCO2Reduced.toFixed(1)} kg`;
  }

  // Transport Integration System
  let transportData = {
    metro: {
      stations: [
        { name: 'Vidhana Soudha Metro', distance: 0.8, routes: [
          { line: 'purple', next: 3, destination: 'Baiyappanahalli' },
          { line: 'green', next: 7, destination: 'Nagasandra' }
        ]},
        { name: 'Cubbon Park Metro', distance: 1.2, routes: [
          { line: 'purple', next: 5, destination: 'Whitefield' }
        ]}
      ]
    },
    bus: {
      stops: [
        { name: 'Vidhana Soudha Bus Stop', distance: 0.5, routes: [
          { number: '201', next: 4, destination: 'Majestic', frequency: 8 },
          { number: '500', next: 12, destination: 'Electronic City', frequency: 15 }
        ]},
        { name: 'Cubbon Park Bus Stop', distance: 1.0, routes: [
          { number: '171', next: 6, destination: 'Kempegowda Bus Station', frequency: 10 }
        ]}
      ]
    },
    ebike: {
      stations: [
        { name: 'E-bike Station A', distance: 0.3, bikes: 8, battery: 85, rate: 2, deposit: 500 },
        { name: 'E-bike Station B', distance: 0.7, bikes: 12, battery: 92, rate: 2, deposit: 500 }
      ]
    }
  };

  function initTransportIntegration() {
    updateTransportDisplay();
    updateDisplayBoards();
    addActivityLog('Transport integration system initialized');
    
    // Update transport data every 30 seconds
    setInterval(updateTransportData, 30000);
  }

  function updateTransportData() {
    // Simulate real-time transport updates
    transportData.metro.stations.forEach(station => {
      station.routes.forEach(route => {
        route.next = Math.max(1, route.next - 1);
        if(route.next === 0) {
          route.next = Math.floor(Math.random() * 10) + 5; // Reset to 5-15 minutes
        }
      });
    });
    
    transportData.bus.stops.forEach(stop => {
      stop.routes.forEach(route => {
        route.next = Math.max(1, route.next - 1);
        if(route.next === 0) {
          route.next = Math.floor(Math.random() * 15) + 5; // Reset to 5-20 minutes
        }
      });
    });
    
    transportData.ebike.stations.forEach(station => {
      // Simulate bike availability changes
      station.bikes = Math.max(0, station.bikes + Math.floor(Math.random() * 3) - 1);
      station.battery = Math.max(60, station.battery + Math.floor(Math.random() * 6) - 3);
    });
    
    updateTransportDisplay();
    updateDisplayBoards();
  }

  function updateTransportDisplay() {
    // Update metro display
    transportData.metro.stations.forEach((station, index) => {
      const stationElement = document.querySelector(`.metro-station:nth-child(${index + 1})`);
      if(stationElement) {
        const nextElements = stationElement.querySelectorAll('.next-train');
        station.routes.forEach((route, routeIndex) => {
          if(nextElements[routeIndex]) {
            nextElements[routeIndex].textContent = `Next: ${route.next} min`;
          }
        });
      }
    });
    
    // Update bus display
    transportData.bus.stops.forEach((stop, index) => {
      const stopElement = document.querySelector(`.bus-stop:nth-child(${index + 1})`);
      if(stopElement) {
        const nextElements = stopElement.querySelectorAll('.next-bus');
        stop.routes.forEach((route, routeIndex) => {
          if(nextElements[routeIndex]) {
            nextElements[routeIndex].textContent = `Next: ${route.next} min`;
          }
        });
      }
    });
    
    // Update e-bike display
    transportData.ebike.stations.forEach((station, index) => {
      const stationElement = document.querySelector(`.ebike-station:nth-child(${index + 1})`);
      if(stationElement) {
        const bikeCount = stationElement.querySelector('.bike-count');
        const batteryLevel = stationElement.querySelector('.battery-level');
        
        if(bikeCount) bikeCount.textContent = `${station.bikes} bikes`;
        if(batteryLevel) batteryLevel.textContent = `Avg: ${station.battery}%`;
      }
    });
  }

  function updateDisplayBoards() {
    const displays = ['north', 'east', 'south', 'west'];
    
    displays.forEach(zone => {
      const displayElement = document.getElementById(`${zone}Display`);
      if(!displayElement) return;
      
      const crowdDensity = crowdData.zones[zone]?.density || 0;
      const lightingIntensity = lightingData.zones[zone]?.intensity || 50;
      
      let message = '';
      let info = '';
      
      if(zone === 'north') {
        const metro = transportData.metro.stations[0];
        message = `🚶 Walk to Metro: ${Math.ceil(metro.distance * 2)} min`;
        info = `Next Metro: ${metro.routes[0].next} min | Crowd: ${getCrowdLevel(crowdDensity)}`;
      } else if(zone === 'east') {
        const bus = transportData.bus.stops[0];
        message = `🚌 Use Bus Stop B: ${Math.ceil(bus.distance * 2)} min`;
        info = `Next Bus: ${bus.routes[0].next} min | Crowd: ${getCrowdLevel(crowdDensity)}`;
      } else if(zone === 'south') {
        const ebike = transportData.ebike.stations[0];
        message = `🚴 E-bike Available: ${Math.ceil(ebike.distance * 2)} min`;
        info = `Battery: ${ebike.battery}% | Distance: ${ebike.distance.toFixed(1)} km`;
      } else if(zone === 'west') {
        message = `🚶 Direct Walk: ${Math.floor(Math.random() * 10) + 5} min`;
        info = `Route: Safe | Weather: Clear`;
      }
      
      const messageElement = displayElement.querySelector('.display-message');
      const infoElement = displayElement.querySelector('.display-info');
      
      if(messageElement) messageElement.textContent = message;
      if(infoElement) infoElement.textContent = info;
      
      // Update display status based on crowd density
      const statusElement = displayElement.parentElement.querySelector('.display-status');
      if(statusElement) {
        if(crowdDensity > 70) {
          statusElement.textContent = 'CROWDED';
          statusElement.className = 'display-status warning';
        } else {
          statusElement.textContent = 'LIVE';
          statusElement.className = 'display-status active';
        }
      }
    });
  }

  function getCrowdLevel(density) {
    if(density > 80) return 'High';
    if(density > 50) return 'Moderate';
    return 'Low';
  }

  // Realistic Map Features and Animation System
  let mapAnimations = {
    crowd: [],
    vehicles: [],
    pedestrians: [],
    trafficLights: [],
    streetLights: []
  };

  function initRealisticMapFeatures() {
    createAnimatedCrowd();
    createVehicleTraffic();
    createPedestrianPaths();
    createTrafficLights();
    createStreetLights();
    addMapDecorations();
    addActivityLog('Realistic map features initialized');
    
    // Start animation loops
    startMapAnimations();
  }

  function createAnimatedCrowd() {
    // Create animated crowd markers for each zone
    const zones = [
      { name: 'north', center: [12.9805, 77.5995], radius: 0.001 },
      { name: 'east', center: [12.9788, 77.6010], radius: 0.0008 },
      { name: 'south', center: [12.9775, 77.5995], radius: 0.0009 },
      { name: 'west', center: [12.9790, 77.5980], radius: 0.0007 }
    ];

    zones.forEach(zone => {
      const crowdCount = Math.floor(Math.random() * 20) + 8;
      
      for(let i = 0; i < crowdCount; i++) {
        const angle = (Math.PI * 2 * i) / crowdCount;
        const distance = Math.random() * zone.radius;
        const lat = zone.center[0] + distance * Math.cos(angle);
        const lng = zone.center[1] + distance * Math.sin(angle);
        
        // Create different types of crowd members
        const crowdTypes = [
          { color: '#31c46f', size: 3, type: 'pedestrian' },
          { color: '#ffa726', size: 2, type: 'cyclist' },
          { color: '#42a5f5', size: 2.5, type: 'visitor' }
        ];
        
        const crowdType = crowdTypes[Math.floor(Math.random() * crowdTypes.length)];
        
        const crowdMember = L.circleMarker([lat, lng], {
          radius: crowdType.size,
          color: crowdType.color,
          fillColor: crowdType.color,
          fillOpacity: 0.7,
          weight: 1
        }).addTo(map);
        
        // Add CSS class for animations
        crowdMember.getElement().classList.add('animated-crowd');
        
        mapAnimations.crowd.push({
          marker: crowdMember,
          zone: zone.name,
          originalPos: [lat, lng],
          angle: angle,
          speed: 0.00001 + Math.random() * 0.00002,
          direction: Math.random() > 0.5 ? 1 : -1,
          type: crowdType.type,
          behavior: Math.random() > 0.7 ? 'wandering' : 'stationary'
        });
      }
    });
  }

  function createVehicleTraffic() {
    // Create vehicle routes with more realistic paths
    const vehicleRoutes = [
      {
        path: [
          [12.9780, 77.5980],
          [12.9785, 77.5990],
          [12.9790, 77.6000],
          [12.9795, 77.6010],
          [12.9800, 77.6020]
        ],
        type: 'car',
        color: '#ff6b6b',
        icon: '🚗'
      },
      {
        path: [
          [12.9800, 77.6020],
          [12.9795, 77.6010],
          [12.9790, 77.6000],
          [12.9785, 77.5990],
          [12.9780, 77.5980]
        ],
        type: 'bus',
        color: '#4ecdc4',
        icon: '🚌'
      },
      {
        path: [
          [12.9770, 77.5990],
          [12.9780, 77.5995],
          [12.9790, 77.6000],
          [12.9800, 77.6005],
          [12.9810, 77.6010]
        ],
        type: 'auto',
        color: '#45b7d1',
        icon: '🛺'
      },
      {
        path: [
          [12.9785, 77.5985],
          [12.9790, 77.5995],
          [12.9795, 77.6005],
          [12.9800, 77.6015]
        ],
        type: 'motorcycle',
        color: '#ff9800',
        icon: '🏍️'
      }
    ];

    vehicleRoutes.forEach(route => {
      const vehicleCount = route.type === 'bus' ? 2 : 4;
      
      for(let i = 0; i < vehicleCount; i++) {
        const vehicle = L.marker(route.path[0], {
          icon: L.divIcon({
            className: 'vehicle-marker',
            html: `<div class="vehicle-icon ${route.type}">${route.icon}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          })
        }).addTo(map);
        
        // Add CSS class for animations
        vehicle.getElement().classList.add('animated-vehicle');
        
        mapAnimations.vehicles.push({
          marker: vehicle,
          route: route.path,
          currentIndex: 0,
          progress: 0,
          speed: 0.00005 + Math.random() * 0.00003,
          type: route.type,
          color: route.color,
          icon: route.icon,
          delay: i * 0.3 // Stagger vehicle starts
        });
      }
    });
  }

  function createPedestrianPaths() {
    // Create walking paths between major points
    const pedestrianRoutes = [
      {
        start: [12.9780, 77.5985],
        end: [12.9800, 77.6005],
        waypoints: [
          [12.9785, 77.5990],
          [12.9790, 77.5995],
          [12.9795, 77.6000]
        ]
      },
      {
        start: [12.9800, 77.6005],
        end: [12.9780, 77.5985],
        waypoints: [
          [12.9795, 77.6000],
          [12.9790, 77.5995],
          [12.9785, 77.5990]
        ]
      }
    ];

    pedestrianRoutes.forEach(route => {
      for(let i = 0; i < 5; i++) {
        const pedestrian = L.circleMarker(route.start, {
          radius: 2,
          color: '#ffa726',
          fillColor: '#ffa726',
          fillOpacity: 0.6,
          weight: 1
        }).addTo(map);
        
        mapAnimations.pedestrians.push({
          marker: pedestrian,
          route: [route.start, ...route.waypoints, route.end],
          currentIndex: 0,
          progress: 0,
          speed: 0.00002 + Math.random() * 0.00001,
          direction: Math.random() > 0.5 ? 1 : -1
        });
      }
    });
  }

  function createTrafficLights() {
    const trafficLightPositions = [
      [12.9785, 77.5995],
      [12.9795, 77.6005],
      [12.9780, 77.6000],
      [12.9800, 77.5990]
    ];

    trafficLightPositions.forEach((pos, index) => {
      const trafficLight = L.circleMarker(pos, {
        radius: 6,
        color: '#333',
        fillColor: '#ff6b6b',
        fillOpacity: 1,
        weight: 2
      }).addTo(map);
      
      mapAnimations.trafficLights.push({
        marker: trafficLight,
        position: pos,
        state: 'red', // red, yellow, green
        timer: 0,
        cycle: 30 + index * 5, // Different cycles for each light
        phase: 0 // 0: red, 1: yellow, 2: green
      });
    });
  }

  function createStreetLights() {
    const streetLightPositions = [
      [12.9782, 77.5988],
      [12.9788, 77.5992],
      [12.9792, 77.5998],
      [12.9798, 77.6002],
      [12.9802, 77.6008],
      [12.9808, 77.6012]
    ];

    streetLightPositions.forEach(pos => {
      const streetLight = L.circleMarker(pos, {
        radius: 3,
        color: '#ffd700',
        fillColor: '#ffd700',
        fillOpacity: 0.8,
        weight: 1
      }).addTo(map);
      
      mapAnimations.streetLights.push({
        marker: streetLight,
        position: pos,
        intensity: 0.5 + Math.random() * 0.5,
        flicker: Math.random() * 0.1
      });
    });
  }

  function addMapDecorations() {
    // Add buildings
    const buildings = [
      { pos: [12.9785, 77.5990], size: 0.0003, color: '#666' },
      { pos: [12.9795, 77.6000], size: 0.0004, color: '#777' },
      { pos: [12.9805, 77.6010], size: 0.0003, color: '#555' },
      { pos: [12.9775, 77.5985], size: 0.0002, color: '#888' }
    ];

    buildings.forEach(building => {
      L.rectangle([
        [building.pos[0] - building.size, building.pos[1] - building.size],
        [building.pos[0] + building.size, building.pos[1] + building.size]
      ], {
        color: building.color,
        fillColor: building.color,
        fillOpacity: 0.7,
        weight: 1
      }).addTo(map);
    });

    // Add trees
    const trees = [
      [12.9780, 77.5982],
      [12.9788, 77.5995],
      [12.9792, 77.6002],
      [12.9800, 77.6008],
      [12.9805, 77.6015]
    ];

    trees.forEach(treePos => {
      L.circleMarker(treePos, {
        radius: 4,
        color: '#228b22',
        fillColor: '#32cd32',
        fillOpacity: 0.6,
        weight: 1
      }).addTo(map);
    });

    // Add park areas
    L.polygon([
      [12.9778, 77.5980],
      [12.9782, 77.5980],
      [12.9782, 77.5985],
      [12.9778, 77.5985]
    ], {
      color: '#90EE90',
      fillColor: '#90EE90',
      fillOpacity: 0.3,
      weight: 1
    }).addTo(map);
  }

  function startMapAnimations() {
    setInterval(animateCrowd, 100);
    setInterval(animateVehicles, 50);
    setInterval(animatePedestrians, 80);
    setInterval(animateTrafficLights, 1000);
    setInterval(animateStreetLights, 200);
  }

  function animateCrowd() {
    mapAnimations.crowd.forEach(crowdMember => {
      const density = crowdData.zones[crowdMember.zone]?.density || 0;
      
      if(crowdMember.behavior === 'wandering') {
        // Move in more complex patterns
        crowdMember.angle += crowdMember.speed * crowdMember.direction;
        const wanderRadius = 0.0001 + (density / 100) * 0.0002;
        const lat = crowdMember.originalPos[0] + Math.cos(crowdMember.angle) * wanderRadius;
        const lng = crowdMember.originalPos[1] + Math.sin(crowdMember.angle) * wanderRadius;
        
        crowdMember.marker.setLatLng([lat, lng]);
      }
      
      // Adjust appearance based on crowd density
      const opacity = 0.3 + (density / 100) * 0.4;
      const size = crowdMember.type === 'cyclist' ? 2 : crowdMember.type === 'visitor' ? 2.5 : 3;
      
      crowdMember.marker.setStyle({
        fillOpacity: opacity,
        radius: size + (density / 100) * 1.5
      });
      
      // Add density-based animation class
      const element = crowdMember.marker.getElement();
      if(element) {
        element.className = element.className.replace(/crowd-density-\w+/g, '');
        if(density > 70) element.classList.add('crowd-density-high');
        else if(density > 40) element.classList.add('crowd-density-medium');
        else element.classList.add('crowd-density-low');
      }
    });
  }

  function animateVehicles() {
    mapAnimations.vehicles.forEach(vehicle => {
      // Apply delay for staggered starts
      if(vehicle.delay > 0) {
        vehicle.delay -= 0.1;
        return;
      }
      
      vehicle.progress += vehicle.speed;
      
      if(vehicle.progress >= 1) {
        vehicle.currentIndex = (vehicle.currentIndex + 1) % vehicle.route.length;
        vehicle.progress = 0;
      }
      
      const currentPos = vehicle.route[vehicle.currentIndex];
      const nextPos = vehicle.route[(vehicle.currentIndex + 1) % vehicle.route.length];
      
      const lat = currentPos[0] + (nextPos[0] - currentPos[0]) * vehicle.progress;
      const lng = currentPos[1] + (nextPos[1] - currentPos[1]) * vehicle.progress;
      
      vehicle.marker.setLatLng([lat, lng]);
      
      // Calculate rotation angle for realistic vehicle orientation
      const angle = Math.atan2(nextPos[1] - currentPos[1], nextPos[0] - currentPos[0]) * 180 / Math.PI;
      const element = vehicle.marker.getElement();
      if(element) {
        element.style.transform = `rotate(${angle}deg)`;
      }
      
      // Add vehicle-specific effects
      const element2 = vehicle.marker.getElement();
      if(element2) {
        element2.classList.add('vehicle-trail');
        setTimeout(() => element2.classList.remove('vehicle-trail'), 1000);
      }
    });
  }

  function animatePedestrians() {
    mapAnimations.pedestrians.forEach(pedestrian => {
      pedestrian.progress += pedestrian.speed;
      
      if(pedestrian.progress >= 1) {
        pedestrian.currentIndex = (pedestrian.currentIndex + 1) % pedestrian.route.length;
        pedestrian.progress = 0;
      }
      
      const currentPos = pedestrian.route[pedestrian.currentIndex];
      const nextPos = pedestrian.route[(pedestrian.currentIndex + 1) % pedestrian.route.length];
      
      const lat = currentPos[0] + (nextPos[0] - currentPos[0]) * pedestrian.progress;
      const lng = currentPos[1] + (nextPos[1] - currentPos[1]) * pedestrian.progress;
      
      pedestrian.marker.setLatLng([lat, lng]);
    });
  }

  function animateTrafficLights() {
    mapAnimations.trafficLights.forEach(light => {
      light.timer++;
      
      if(light.timer >= light.cycle) {
        light.phase = (light.phase + 1) % 3;
        light.timer = 0;
        
        let color, state;
        switch(light.phase) {
          case 0: color = '#ff6b6b'; state = 'red'; break;
          case 1: color = '#ffd700'; state = 'yellow'; break;
          case 2: color = '#32cd32'; state = 'green'; break;
        }
        
        light.marker.setStyle({
          fillColor: color,
          color: color
        });
        light.state = state;
      }
    });
  }

  function animateStreetLights() {
    mapAnimations.streetLights.forEach(light => {
      // Simulate flickering based on intensity
      const flicker = (Math.random() - 0.5) * light.flicker;
      const opacity = Math.max(0.3, Math.min(1, light.intensity + flicker));
      
      light.marker.setStyle({
        fillOpacity: opacity,
        radius: 2 + light.intensity * 2
      });
    });
  }

  // Initialize the challenge system
  initChallengeSystem();
  
  // Initialize crowd monitoring
  initCrowdMonitoring();
  
  // Initialize accessibility and safety features
  initAccessibilitySafety();
  
  // Initialize energy-aware lighting system
  initEnergyLighting();
  
  // Initialize transport integration
  initTransportIntegration();
  
  // Initialize realistic map features
  initRealisticMapFeatures();
  
  // Initialize tab navigation
  initTabNavigation();
  
  // Update overview dashboard every 5 seconds
  setInterval(updateOverviewDashboard, 5000);
  
  // Simulate some activity every 30 seconds for demo
  setInterval(simulateActivity, 30000);

  // Camera and Crowd Detection System
  let cameraStream = null;
  let detectionModel = null;
  let isDetectionActive = false;
  let detectionInterval = null;
  let lastDetectionCount = 0;
  let alertCooldown = false;

  // Camera elements
  const cameraFeed = document.getElementById('cameraFeed');
  const detectionCanvas = document.getElementById('detectionCanvas');
  const startCameraBtn = document.getElementById('startCamera');
  const stopCameraBtn = document.getElementById('stopCamera');
  const toggleDetectionBtn = document.getElementById('toggleDetection');
  const cameraStatus = document.getElementById('cameraStatus');
  const cameraStatusText = document.getElementById('cameraStatusText');

  // Detection result elements
  const detectedPeopleEl = document.getElementById('detectedPeople');
  const crowdDensityEl = document.getElementById('crowdDensity');
  const zoneStatusEl = document.getElementById('zoneStatus');
  const zoneAlertsEl = document.getElementById('zoneAlerts');

  // Initialize camera system
  function initCameraSystem() {
    setupCameraEventListeners();
    loadDetectionModel();
    addActivityLog('Camera and crowd detection system initialized');
  }

  function setupCameraEventListeners() {
    startCameraBtn.addEventListener('click', startCamera);
    stopCameraBtn.addEventListener('click', stopCamera);
    toggleDetectionBtn.addEventListener('click', toggleDetection);
  }

  async function loadDetectionModel() {
    try {
      console.log('Loading COCO-SSD model...');
      detectionModel = await cocoSsd.load();
      console.log('Model loaded successfully');
      addActivityLog('AI detection model loaded');
    } catch (error) {
      console.error('Error loading detection model:', error);
      showNotification('Failed to load AI model', 'danger');
    }
  }

  async function startCamera() {
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'environment' // Use back camera if available
        }
      };

      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraFeed.srcObject = cameraStream;
      
      // Update UI
      startCameraBtn.disabled = true;
      stopCameraBtn.disabled = false;
      toggleDetectionBtn.disabled = false;
      cameraStatus.classList.add('active');
      cameraStatusText.textContent = 'Camera Online';
      
      // Setup canvas
      const ctx = detectionCanvas.getContext('2d');
      detectionCanvas.width = cameraFeed.videoWidth || 640;
      detectionCanvas.height = cameraFeed.videoHeight || 480;
      
      addActivityLog('Camera started successfully');
      showNotification('Camera access granted! 📹', 'info');
      
    } catch (error) {
      console.error('Error accessing camera:', error);
      showNotification('Camera access denied. Please allow camera permissions.', 'danger');
      addActivityLog('Camera access failed: ' + error.message);
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    
    cameraFeed.srcObject = null;
    
    // Clear canvas
    const ctx = detectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    
    // Stop detection if running
    if (isDetectionActive) {
      toggleDetection();
    }
    
    // Update UI
    startCameraBtn.disabled = false;
    stopCameraBtn.disabled = true;
    toggleDetectionBtn.disabled = true;
    cameraStatus.classList.remove('active');
    cameraStatusText.textContent = 'Camera Offline';
    
    // Reset detection stats
    detectedPeopleEl.textContent = '0';
    crowdDensityEl.textContent = '0%';
    zoneStatusEl.textContent = 'Safe';
    
    addActivityLog('Camera stopped');
  }

  function toggleDetection() {
    if (!detectionModel) {
      showNotification('Detection model not loaded yet', 'warning');
      return;
    }

    isDetectionActive = !isDetectionActive;
    
    if (isDetectionActive) {
      toggleDetectionBtn.textContent = 'Stop Detection';
      toggleDetectionBtn.classList.remove('success');
      toggleDetectionBtn.classList.add('warning');
      
      // Start detection loop
      detectionInterval = setInterval(detectPeople, 1000); // Detect every second
      addActivityLog('Crowd detection started');
      showNotification('AI detection activated! 🤖', 'info');
    } else {
      toggleDetectionBtn.textContent = 'Start Detection';
      toggleDetectionBtn.classList.remove('warning');
      toggleDetectionBtn.classList.add('success');
      
      // Stop detection loop
      clearInterval(detectionInterval);
      
      // Clear canvas
      const ctx = detectionCanvas.getContext('2d');
      ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
      
      addActivityLog('Crowd detection stopped');
    }
  }

  async function detectPeople() {
    if (!detectionModel || !cameraFeed.videoWidth) return;

    try {
      const predictions = await detectionModel.detect(cameraFeed);
      
      // Filter for people only
      const peopleDetections = predictions.filter(prediction => 
        prediction.class === 'person' && prediction.score > 0.5
      );

      const peopleCount = peopleDetections.length;
      
      // Update detection stats
      detectedPeopleEl.textContent = peopleCount;
      
      // Calculate crowd density (simplified calculation)
      const density = Math.min(100, (peopleCount / 10) * 100); // Assuming 10 people = 100% density
      crowdDensityEl.textContent = Math.round(density) + '%';
      
      // Determine zone status
      let zoneStatus = 'Safe';
      let zoneClass = 'safe';
      
      if (peopleCount < 10) {
        zoneStatus = 'Safe Zone';
        zoneClass = 'safe';
      } else if (peopleCount >= 10 && peopleCount < 50) {
        zoneStatus = 'Medium Zone';
        zoneClass = 'medium';
      } else {
        zoneStatus = 'Danger Zone';
        zoneClass = 'danger';
      }
      
      zoneStatusEl.textContent = zoneStatus;
      zoneStatusEl.className = `stat-value ${zoneClass}`;
      
      // Draw bounding boxes
      drawDetections(peopleDetections);
      
      // Handle alerts
      handleCrowdAlerts(peopleCount, zoneClass);
      
      // Update last detection count
      lastDetectionCount = peopleCount;
      
    } catch (error) {
      console.error('Detection error:', error);
    }
  }

  function drawDetections(detections) {
    const ctx = detectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    
    detections.forEach(detection => {
      const [x, y, width, height] = detection.bbox;
      
      // Draw bounding box
      ctx.strokeStyle = '#31c46f';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      
      // Draw label background
      ctx.fillStyle = 'rgba(49, 196, 111, 0.8)';
      ctx.fillRect(x, y - 20, 80, 20);
      
      // Draw label text
      ctx.fillStyle = '#042129';
      ctx.font = '12px Arial';
      ctx.fillText(`Person ${Math.round(detection.score * 100)}%`, x + 5, y - 5);
    });
  }

  function handleCrowdAlerts(peopleCount, zoneClass) {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    
    // Clear previous alerts
    zoneAlertsEl.innerHTML = '';
    
    let alertMessage = '';
    let alertIcon = '';
    
    if (zoneClass === 'safe') {
      alertMessage = `✅ Safe Zone: ${peopleCount} people detected. Area is safe for pedestrians.`;
      alertIcon = '✅';
    } else if (zoneClass === 'medium') {
      alertMessage = `⚠️ Medium Zone: ${peopleCount} people detected. Moderate crowd density. Exercise caution.`;
      alertIcon = '⚠️';
    } else if (zoneClass === 'danger') {
      alertMessage = `🚨 DANGER ZONE: ${peopleCount} people detected! High crowd density. Immediate attention required!`;
      alertIcon = '🚨';
      
      // Trigger audio alert for danger zone
      if (!alertCooldown) {
        triggerDangerAlert();
        alertCooldown = true;
        setTimeout(() => { alertCooldown = false; }, 5000); // 5 second cooldown
      }
    }
    
    // Create alert element
    const alertEl = document.createElement('div');
    alertEl.className = `alert-message ${zoneClass}`;
    alertEl.innerHTML = `
      <div class="alert-icon">${alertIcon}</div>
      <div class="alert-text">${alertMessage}</div>
      <div class="alert-time">${timeString}</div>
    `;
    
    zoneAlertsEl.appendChild(alertEl);
    
    // Update map with crowd data
    updateMapWithCrowdData(peopleCount, zoneClass);
  }

  function triggerDangerAlert() {
    // Visual alert
    showNotification('🚨 DANGER ZONE DETECTED! High crowd density!', 'danger');
    
    // Audio alert
    try {
      const utterance = new SpeechSynthesisUtterance('Danger zone detected! High crowd density! Please exercise extreme caution!');
      utterance.volume = 0.8;
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.log('Speech synthesis not available');
    }
    
    // Flash the danger zone status
    const zoneStatus = document.getElementById('zoneStatus');
    zoneStatus.style.animation = 'dangerPulse 0.5s ease-in-out 3';
    
    addActivityLog(`DANGER ALERT: High crowd density detected (${lastDetectionCount} people)`);
  }

  function updateMapWithCrowdData(peopleCount, zoneClass) {
    // Update the existing crowd monitoring system with real camera data
    const zones = ['north', 'east', 'south', 'west'];
    const randomZone = zones[Math.floor(Math.random() * zones.length)];
    
    // Convert people count to density percentage
    const density = Math.min(100, (peopleCount / 10) * 100);
    
    // Update crowd data
    crowdData.zones[randomZone] = {
      density: density,
      count: peopleCount,
      status: zoneClass === 'safe' ? 'low' : zoneClass === 'medium' ? 'high' : 'critical'
    };
    
    // Update zone display
    updateZoneDisplay(randomZone, density, peopleCount, crowdData.zones[randomZone].status);
    
    // Update overview dashboard
    updateOverviewDashboard();
  }

  // Initialize camera system when page loads
  initCameraSystem();

  // AI Crisis Assistant System
  let aiAssistant = {
    isListening: false,
    isSpeaking: false,
    recognition: null,
    synthesis: null,
    currentLocation: null,
    emergencyMode: false,
    conversationHistory: []
  };

  // Initialize AI Assistant
  function initAIAssistant() {
    setupVoiceRecognition();
    setupTextToSpeech();
    setupChatInterface();
    setupEmergencyActions();
    setupLocationServices();
    updateCrisisStatus();
    addActivityLog('AI Crisis Assistant initialized');
    
    // Update location every 30 seconds
    setInterval(updateLocationServices, 30000);
  }

  function setupVoiceRecognition() {
    // Check for speech recognition support
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      aiAssistant.recognition = new SpeechRecognition();
      
      aiAssistant.recognition.continuous = false;
      aiAssistant.recognition.interimResults = false;
      aiAssistant.recognition.lang = 'en-US';
      
      aiAssistant.recognition.onstart = () => {
        aiAssistant.isListening = true;
        updateVoiceUI();
        document.getElementById('voiceStatus').textContent = 'Listening...';
      };
      
      aiAssistant.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        processVoiceInput(transcript);
      };
      
      aiAssistant.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        aiAssistant.isListening = false;
        updateVoiceUI();
        document.getElementById('voiceStatus').textContent = 'Error occurred';
      };
      
      aiAssistant.recognition.onend = () => {
        aiAssistant.isListening = false;
        updateVoiceUI();
        document.getElementById('voiceStatus').textContent = 'Tap to speak';
      };
    }
    
    // Setup voice controls
    document.getElementById('startVoice').addEventListener('click', startVoiceRecognition);
    document.getElementById('stopVoice').addEventListener('click', stopVoiceRecognition);
    document.getElementById('emergencyCall').addEventListener('click', triggerEmergencyCall);
    
    // Voice circle click
    document.getElementById('voiceCircle').addEventListener('click', () => {
      if (!aiAssistant.isListening) {
        startVoiceRecognition();
      } else {
        stopVoiceRecognition();
      }
    });
  }

  function setupTextToSpeech() {
    if ('speechSynthesis' in window) {
      aiAssistant.synthesis = window.speechSynthesis;
    }
  }

  function setupChatInterface() {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendMessage');
    
    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  function setupEmergencyActions() {
    document.getElementById('medicalHelp').addEventListener('click', () => handleEmergency('medical'));
    document.getElementById('fireEmergency').addEventListener('click', () => handleEmergency('fire'));
    document.getElementById('securityAlert').addEventListener('click', () => handleEmergency('security'));
    document.getElementById('evacuationRoute').addEventListener('click', () => handleEmergency('evacuation'));
  }

  function setupLocationServices() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          aiAssistant.currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          updateLocationDisplay();
          document.getElementById('locationStatus').classList.add('active');
          document.getElementById('locationStatusText').textContent = 'Location acquired';
        },
        (error) => {
          console.error('Geolocation error:', error);
          document.getElementById('locationStatusText').textContent = 'Location unavailable';
        }
      );
    }
  }

  function startVoiceRecognition() {
    if (aiAssistant.recognition && !aiAssistant.isListening) {
      aiAssistant.recognition.start();
    }
  }

  function stopVoiceRecognition() {
    if (aiAssistant.recognition && aiAssistant.isListening) {
      aiAssistant.recognition.stop();
    }
  }

  function updateVoiceUI() {
    const voiceCircle = document.getElementById('voiceCircle');
    const startBtn = document.getElementById('startVoice');
    const stopBtn = document.getElementById('stopVoice');
    
    if (aiAssistant.isListening) {
      voiceCircle.classList.add('listening');
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      voiceCircle.classList.remove('listening');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
    
    if (aiAssistant.isSpeaking) {
      voiceCircle.classList.add('speaking');
    } else {
      voiceCircle.classList.remove('speaking');
    }
  }

  function processVoiceInput(transcript) {
    addChatMessage(transcript, 'user');
    const response = processAIRequest(transcript);
    addChatMessage(response, 'ai');
    speakResponse(response);
  }

  function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (message) {
      addChatMessage(message, 'user');
      const response = processAIRequest(message);
      addChatMessage(response, 'ai');
      speakResponse(response);
      chatInput.value = '';
    }
  }

  function addChatMessage(message, sender) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}-message`;
    
    const avatar = sender === 'ai' ? '🤖' : '👤';
    const time = new Date().toLocaleTimeString();
    
    messageDiv.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-text">${message}</div>
        <div class="message-time">${time}</div>
      </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Store in conversation history
    aiAssistant.conversationHistory.push({
      message: message,
      sender: sender,
      timestamp: new Date()
    });
  }

  function processAIRequest(input) {
    const lowerInput = input.toLowerCase();
    
    // Emergency keywords
    if (lowerInput.includes('emergency') || lowerInput.includes('help') || lowerInput.includes('urgent')) {
      return handleEmergencyRequest(input);
    }
    
    // Medical keywords
    if (lowerInput.includes('medical') || lowerInput.includes('doctor') || lowerInput.includes('hospital') || lowerInput.includes('ambulance')) {
      return handleMedicalRequest(input);
    }
    
    // Exit/evacuation keywords
    if (lowerInput.includes('exit') || lowerInput.includes('evacuate') || lowerInput.includes('leave') || lowerInput.includes('safe')) {
      return handleExitRequest(input);
    }
    
    // Fire keywords
    if (lowerInput.includes('fire') || lowerInput.includes('smoke') || lowerInput.includes('burning')) {
      return handleFireRequest(input);
    }
    
    // Security keywords
    if (lowerInput.includes('security') || lowerInput.includes('threat') || lowerInput.includes('danger') || lowerInput.includes('suspicious')) {
      return handleSecurityRequest(input);
    }
    
    // Location keywords
    if (lowerInput.includes('where') || lowerInput.includes('location') || lowerInput.includes('position')) {
      return handleLocationRequest(input);
    }
    
    // General help
    return handleGeneralRequest(input);
  }

  function handleEmergencyRequest(input) {
    aiAssistant.emergencyMode = true;
    updateCrisisStatus();
    
    return `🚨 EMERGENCY MODE ACTIVATED! I've detected an emergency situation. Here's what I can do to help:

1. 🏥 Medical Emergency: I can guide you to the nearest medical facility
2. 🚪 Safe Exit: I can show you the safest evacuation route
3. 📞 Emergency Services: I can connect you to emergency services
4. 📍 Your Location: I can provide your exact location to responders

What type of emergency are you experiencing? Please be specific so I can provide the most appropriate assistance.`;
  }

  function handleMedicalRequest(input) {
    const nearestExit = findNearestExit();
    return `🏥 MEDICAL ASSISTANCE REQUESTED

I understand you need medical help. Here's what I can do:

📍 Your current location: ${aiAssistant.currentLocation ? 
  `${aiAssistant.currentLocation.lat.toFixed(6)}, ${aiAssistant.currentLocation.lng.toFixed(6)}` : 
  'Location not available'}

🚪 Nearest safe exit: ${nearestExit.name} (${nearestExit.distance}m away)

📞 Emergency contacts:
- Ambulance: 108
- Hospital: +91-80-2222-2222

🚑 I'm alerting medical services of your location. Stay calm and follow these steps:
1. If you're injured, try to stay still
2. If you can move safely, head towards ${nearestExit.name}
3. Look for medical personnel or first aid stations
4. Keep this device with you for location tracking

Would you like me to guide you to the nearest exit or connect you with emergency services?`;
  }

  function handleExitRequest(input) {
    const nearestExit = findNearestExit();
    const safeRoute = calculateSafeRoute(nearestExit);
    
    return `🚪 SAFE EXIT GUIDANCE

I'll help you find the safest way out. Here's your evacuation plan:

📍 Nearest safe exit: ${nearestExit.name}
📏 Distance: ${nearestExit.distance}m
⏱️ Estimated time: ${Math.ceil(nearestExit.distance / 1.4)} seconds

🛣️ Safe route instructions:
${safeRoute.instructions}

⚠️ Safety tips:
- Stay calm and move steadily
- Follow the green route markers
- Avoid crowded areas
- Help others if it's safe to do so
- Keep this device with you

🚨 If you encounter obstacles, I can recalculate your route. Just let me know what you see ahead.

Would you like me to provide turn-by-turn navigation or connect you with emergency services?`;
  }

  function handleFireRequest(input) {
    aiAssistant.emergencyMode = true;
    updateCrisisStatus();
    
    return `🔥 FIRE EMERGENCY DETECTED!

🚨 IMMEDIATE ACTION REQUIRED:

1. 🚪 EVACUATE IMMEDIATELY - Head to the nearest exit
2. 🚫 DO NOT use elevators
3. 🧯 Use fire extinguishers only if safe
4. 📞 Alert others as you evacuate
5. 🚒 Fire department has been notified

📍 Your evacuation route:
${getFireEvacuationRoute()}

⚠️ FIRE SAFETY:
- Stay low to avoid smoke
- Feel doors before opening
- Use stairs, not elevators
- Move away from the building
- Call 101 for fire department

🚨 I'm tracking your location and will guide you to safety. Keep this device with you and follow my instructions.

Are you able to move? Do you see any obstacles in your path?`;
  }
 // ------------------- AI Chatbot (GenAI Assistant) -------------------
function initAIChatbot() {
  const chatMessages = document.getElementById("chatMessages");
  const userMessage = document.getElementById("userMessage");
  const sendMessageBtn = document.getElementById("sendMessage");

  if (!chatMessages || !userMessage || !sendMessageBtn) return;

  sendMessageBtn.addEventListener("click", sendChatMessage);
  userMessage.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  function addMessage(sender, text) {
    const msg = document.createElement("div");
    msg.className = `chat-message ${sender}`;
    msg.innerHTML = `<div class="bubble">${text}</div>`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendChatMessage() {
    const text = userMessage.value.trim();
    if (!text) return;

    addMessage("user", text);
    userMessage.value = "";
    addMessage("bot", "Thinking... 🤔");

    try {
  const res = await fetch("http://127.0.0.1:8000/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: text })
  });


      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || "Sorry, I didn’t understand that.";
      chatMessages.lastChild.querySelector(".bubble").innerText = reply;
    } catch (err) {
      chatMessages.lastChild.querySelector(".bubble").innerText = "⚠️ Error fetching response.";
      console.error(err);
    }
  }
}

// Initialize AI Chatbot
initAIChatbot();


  function handleSecurityRequest(input) {
    aiAssistant.emergencyMode = true;
    updateCrisisStatus();
    
    return `🛡️ SECURITY ALERT ACTIVATED

I understand you've encountered a security concern. Here's what I can do:

🚨 IMMEDIATE ACTIONS:
1. 📞 Police have been notified (100)
2. 📍 Your location is being tracked
3. 🚪 Safe exit routes are being calculated
4. 👮 Security personnel are being alerted

📍 Your current location: ${aiAssistant.currentLocation ? 
  `${aiAssistant.currentLocation.lat.toFixed(6)}, ${aiAssistant.currentLocation.lng.toFixed(6)}` : 
  'Location not available'}

🛡️ SECURITY PROTOCOLS:
- Stay calm and assess the situation
- Move to a safe location if possible
- Avoid confrontation
- Keep this device with you
- Follow security personnel instructions

🚪 Safe exit options:
${getSecurityEvacuationRoutes()}

📞 Emergency contacts:
- Police: 100
- Security: +91-80-2222-3333

Can you describe what you're seeing? Are you in immediate danger?`;
  }

  function handleLocationRequest(input) {
    return `📍 LOCATION INFORMATION

Your current position:
- Latitude: ${aiAssistant.currentLocation ? aiAssistant.currentLocation.lat.toFixed(6) : 'Not available'}
- Longitude: ${aiAssistant.currentLocation ? aiAssistant.currentLocation.lng.toFixed(6) : 'Not available'}
- Location: M. Chinnaswamy Stadium, Bengaluru

🚪 Nearby exits:
${getNearbyExits()}

🏥 Nearby facilities:
- Medical station: 150m North
- First aid: 200m East
- Security office: 100m South

📱 Location sharing:
- Your location is being tracked for safety
- Emergency services can access your position
- Location data is encrypted and secure

Would you like directions to a specific location or facility?`;
  }

  function handleGeneralRequest(input) {
    return `🤖 I'm your AI Crisis Assistant, here to help you in emergency situations.

I can assist you with:
🚨 Emergency situations and alerts
🏥 Medical assistance and first aid
🚪 Safe exit routes and evacuation
🔥 Fire emergencies and safety
🛡️ Security concerns and threats
📍 Location services and navigation
📞 Emergency contact connections

Just tell me what you need help with, and I'll provide specific guidance and assistance.

Examples of what you can say:
- "I need medical help"
- "Where is the nearest safe exit?"
- "There's a fire emergency"
- "I feel unsafe"
- "Show me evacuation routes"

How can I help you today?`;
  }

  function speakResponse(text) {
    if (aiAssistant.synthesis) {
      aiAssistant.isSpeaking = true;
      updateVoiceUI();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      utterance.volume = 0.8;
      
      utterance.onend = () => {
        aiAssistant.isSpeaking = false;
        updateVoiceUI();
      };
      
      utterance.onerror = () => {
        aiAssistant.isSpeaking = false;
        updateVoiceUI();
      };
      
      aiAssistant.synthesis.speak(utterance);
    }
  }

  function handleEmergency(type) {
    aiAssistant.emergencyMode = true;
    updateCrisisStatus();
    
    let message = '';
    switch(type) {
      case 'medical':
        message = handleMedicalRequest('medical emergency');
        break;
      case 'fire':
        message = handleFireRequest('fire emergency');
        break;
      case 'security':
        message = handleSecurityRequest('security alert');
        break;
      case 'evacuation':
        message = handleExitRequest('evacuation needed');
        break;
    }
    
    addChatMessage(message, 'ai');
    speakResponse(message);
    
    // Trigger emergency protocols
    triggerEmergencyProtocols(type);
  }

  function triggerEmergencyCall() {
    addChatMessage('🚨 EMERGENCY CALL INITIATED! Connecting you to emergency services...', 'ai');
    speakResponse('Emergency call initiated. Connecting you to emergency services.');
    
    // Simulate emergency call
    setTimeout(() => {
      addChatMessage('📞 Connected to emergency services. Your location has been shared. Stay on the line for further instructions.', 'ai');
    }, 2000);
  }

  function triggerEmergencyProtocols(type) {
    // Update system status
    addActivityLog(`Emergency protocol activated: ${type}`);
    
    // Update crisis status
    updateCrisisStatus();
    
    // Show emergency notification
    showNotification(`🚨 ${type.toUpperCase()} EMERGENCY ACTIVATED!`, 'danger');
    
    // Update map with emergency indicators
    updateMapWithEmergency(type);
  }

  function findNearestExit() {
    if (!aiAssistant.currentLocation) {
      return { name: 'North Gate', distance: 200 };
    }
    
    let nearest = { name: 'North Gate', distance: 1000 };
    
    EXITS.features.forEach(exit => {
      if (exit.properties.type === 'exit') {
        const distance = distance(
          aiAssistant.currentLocation,
          { lat: exit.geometry.coordinates[1], lng: exit.geometry.coordinates[0] }
        );
        
        if (distance < nearest.distance) {
          nearest = {
            name: exit.properties.name,
            distance: Math.round(distance)
          };
        }
      }
    });
    
    return nearest;
  }

  function calculateSafeRoute(exit) {
    return {
      instructions: `1. Head ${exit.name.includes('North') ? 'north' : exit.name.includes('South') ? 'south' : exit.name.includes('East') ? 'east' : 'west'} towards ${exit.name}\n2. Follow the green route markers\n3. Avoid crowded areas\n4. Keep moving steadily`
    };
  }

  function getFireEvacuationRoute() {
    const nearestExit = findNearestExit();
    return `🚪 Primary exit: ${nearestExit.name} (${nearestExit.distance}m)\n🔄 Alternative: ${nearestExit.name === 'North Gate' ? 'South Gate' : 'North Gate'}\n⚠️ Avoid: Elevators, crowded areas`;
  }

  function getSecurityEvacuationRoutes() {
    return `🚪 Primary: North Gate (200m)\n🚪 Secondary: South Gate (250m)\n🚪 Tertiary: East Gate (300m)\n⚠️ Avoid: West Gate (under maintenance)`;
  }

  function getNearbyExits() {
    return `🚪 North Gate: 200m\n🚪 South Gate: 250m\n🚪 East Gate: 300m\n🚪 West Gate: 350m`;
  }

  function updateLocationServices() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          aiAssistant.currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          updateLocationDisplay();
        },
        (error) => {
          console.error('Geolocation error:', error);
        }
      );
    }
  }

  function updateLocationDisplay() {
    if (aiAssistant.currentLocation) {
      document.getElementById('currentLocation').textContent = 
        `${aiAssistant.currentLocation.lat.toFixed(6)}, ${aiAssistant.currentLocation.lng.toFixed(6)}`;
      
      const nearestExit = findNearestExit();
      document.getElementById('nearestExit').textContent = `${nearestExit.name} (${nearestExit.distance}m)`;
      document.getElementById('distanceToSafety').textContent = `${nearestExit.distance}m`;
    }
  }

  function updateCrisisStatus() {
    const overallStatus = document.getElementById('overallStatus');
    const crowdStatus = document.getElementById('crowdStatus');
    const exitStatus = document.getElementById('exitStatus');
    const emergencyStatus = document.getElementById('emergencyStatus');
    
    if (aiAssistant.emergencyMode) {
      overallStatus.className = 'status-card danger';
      overallStatus.querySelector('.status-value').textContent = 'Emergency';
      overallStatus.querySelector('.status-icon').textContent = '🚨';
      
      emergencyStatus.className = 'status-card danger';
      emergencyStatus.querySelector('.status-value').textContent = 'Active';
      emergencyStatus.querySelector('.status-icon').textContent = '🚨';
    } else {
      overallStatus.className = 'status-card safe';
      overallStatus.querySelector('.status-value').textContent = 'Safe';
      overallStatus.querySelector('.status-icon').textContent = '✅';
      
      emergencyStatus.className = 'status-card safe';
      emergencyStatus.querySelector('.status-value').textContent = 'Standby';
      emergencyStatus.querySelector('.status-icon').textContent = '🚨';
    }
    
    // Update crowd status based on existing crowd data
    const totalCrowd = Object.values(crowdData.zones).reduce((sum, zone) => sum + zone.count, 0);
    if (totalCrowd > 100) {
      crowdStatus.className = 'status-card warning';
      crowdStatus.querySelector('.status-value').textContent = 'High';
    } else if (totalCrowd > 50) {
      crowdStatus.className = 'status-card warning';
      crowdStatus.querySelector('.status-value').textContent = 'Medium';
    } else {
      crowdStatus.className = 'status-card safe';
      crowdStatus.querySelector('.status-value').textContent = 'Low';
    }
    
    // Update exit status
    exitStatus.className = 'status-card safe';
    exitStatus.querySelector('.status-value').textContent = 'All Clear';
  }

  function updateMapWithEmergency(type) {
    // Add emergency markers to map
    if (aiAssistant.currentLocation) {
      const emergencyMarker = L.marker([aiAssistant.currentLocation.lat, aiAssistant.currentLocation.lng], {
        icon: L.divIcon({
          className: 'emergency-marker',
          html: '🚨',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map);
      
      emergencyMarker.bindPopup(`Emergency: ${type.toUpperCase()}<br>Location: ${aiAssistant.currentLocation.lat.toFixed(6)}, ${aiAssistant.currentLocation.lng.toFixed(6)}`);
    }
  }

  // Global function for emergency contacts
  window.callEmergency = function(type) {
    const contacts = {
      ambulance: '108',
      fire: '101',
      police: '100',
      hospital: '+91-80-2222-2222'
    };
    
    const number = contacts[type];
    if (number) {
      addChatMessage(`📞 Calling ${type} at ${number}...`, 'ai');
      speakResponse(`Calling ${type} at ${number}`);
      
      // Simulate call
      setTimeout(() => {
        addChatMessage(`📞 Connected to ${type}. Your location has been shared.`, 'ai');
      }, 2000);
    }
  };

  // Initialize AI Assistant when page loads
  initAIAssistant();

  // expose chooseExit to global so markers can call it
  window.chooseExit = chooseExit;

})();
