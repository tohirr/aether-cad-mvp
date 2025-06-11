const mapboxgl = { accessToken: 'pk.eyJ1IjoidG9oZWVyIiwiYSI6ImNtYW5uMGpwNjAwb2cyanF4ODJxcHg0M20ifQ.9ycLcAqj1-dfw1j9zjbhZA' };

let state = {
    scene: null,
    camera: null,
    renderer: null,
    plane: null,
    points: [],
    pointMeshes: [],
    lineMeshes: [],
    shapeMeshes: [], // New: for filled shapes
    previewLine: null,
    isDrawing: false,
    controls: {
        isMouseDown: false,
        isPanning: false,
        mouseX: 0,
        mouseY: 0,
        phi: Math.PI / 6,
        theta: 0,
        radius: 120,
        target: new THREE.Vector3(0, 0, 0),
        panSpeed: 0.5,
        rotateSpeed: 0.01,
        zoomSpeed: 0.1
    }
};

function initScene(center = [0, 0]) {
    const container = document.getElementById('three-canvas');
    const scene = new THREE.Scene();
    const width = container.clientWidth;
    const height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    state.camera = camera;
    updateCameraPosition();

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040, 0.26));

    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(50, 100, 50);
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    scene.add(light);

    // Load satellite imagery
    const loader = new THREE.TextureLoader();
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center[0]},${center[1]},19.5/1024x1024?access_token=${mapboxgl.accessToken}`;
    
    loader.load(url, texture => {
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshLambertMaterial({ map: texture })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        scene.add(plane);
        state.plane = plane;
        
        document.getElementById('drawStatus').textContent = 'Map loaded - Click "Start Drawing" to begin';
    }, undefined, error => {
        console.error('Error loading satellite image:', error);
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshLambertMaterial({ color: 0x90EE90 })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        scene.add(plane);
        state.plane = plane;
        
        document.getElementById('drawStatus').textContent = 'Fallback mode - Click "Start Drawing" to begin';
    });

    state.scene = scene;
    state.renderer = renderer;

    setupControls();
    setupDrawing();

    window.addEventListener('resize', () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });

    animate();
}

function updateCameraPosition() {
    const { phi, theta, radius, target } = state.controls;
    const x = target.x + radius * Math.sin(phi) * Math.cos(theta);
    const y = target.y + radius * Math.cos(phi);
    const z = target.z + radius * Math.sin(phi) * Math.sin(theta);
    
    state.camera.position.set(x, y, z);
    state.camera.lookAt(target);
}

function setupControls() {
    const canvas = state.renderer.domElement;
    const controls = state.controls;

    canvas.addEventListener('mousedown', e => {
        e.preventDefault();
        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
        
        if (e.button === 2) {
            controls.isMouseDown = true;
        } else if (e.button === 1) {
            controls.isPanning = true;
        }
    });

    canvas.addEventListener('mousemove', e => {
        const dx = e.clientX - controls.mouseX;
        const dy = e.clientY - controls.mouseY;

        if (controls.isMouseDown) {
            controls.theta -= dx * controls.rotateSpeed;
            controls.phi += dy * controls.rotateSpeed;
            controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, controls.phi));
            updateCameraPosition();
        } else if (controls.isPanning) {
            const panX = -dx * controls.panSpeed * 0.1;
            const panZ = dy * controls.panSpeed * 0.1;
            
            const cosTheta = Math.cos(-controls.theta);
            const sinTheta = Math.sin(-controls.theta);
            
            controls.target.x += panX * cosTheta - panZ * sinTheta;
            controls.target.z += panX * sinTheta + panZ * cosTheta;
            
            updateCameraPosition();
        } else if (state.isDrawing && state.points.length > 0) {
            // Update preview line while drawing
            updatePreviewLine(e);
        }

        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
    });

    canvas.addEventListener('mouseup', e => {
        controls.isMouseDown = false;
        controls.isPanning = false;
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1 + controls.zoomSpeed : 1 - controls.zoomSpeed;
        controls.radius = Math.max(10, Math.min(500, controls.radius * zoomFactor));
        updateCameraPosition();
    });

    // Touch events
    let lastTouchDistance = 0;
    
    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        if (e.touches.length === 1) {
            controls.mouseX = e.touches[0].clientX;
            controls.mouseY = e.touches[0].clientY;
            controls.isMouseDown = true;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
        }
    });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (e.touches.length === 1 && controls.isMouseDown) {
            const dx = e.touches[0].clientX - controls.mouseX;
            const dy = e.touches[0].clientY - controls.mouseY;
            
            controls.theta -= dx * controls.rotateSpeed;
            controls.phi += dy * controls.rotateSpeed;
            controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, controls.phi));
            updateCameraPosition();
            
            controls.mouseX = e.touches[0].clientX;
            controls.mouseY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (lastTouchDistance > 0) {
                const zoomFactor = distance / lastTouchDistance;
                controls.radius = Math.max(10, Math.min(500, controls.radius / zoomFactor));
                updateCameraPosition();
            }
            lastTouchDistance = distance;
        }
    });

    canvas.addEventListener('touchend', e => {
        e.preventDefault();
        controls.isMouseDown = false;
        lastTouchDistance = 0;
    });
}

// New function to update the preview line
function updatePreviewLine(event) {
    if (!state.plane || state.points.length === 0) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const rect = state.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, state.camera);
    const intersects = raycaster.intersectObject(state.plane);
    
    if (intersects.length > 0) {
        const mousePoint = intersects[0].point;
        const lastPoint = state.points[state.points.length - 1];
        
        // Remove old preview line
        if (state.previewLine) {
            state.scene.remove(state.previewLine);
        }
        
        // Create new preview line
        const points = [
            new THREE.Vector3(lastPoint.x, 0.15, lastPoint.z),
            new THREE.Vector3(mousePoint.x, 0.15, mousePoint.z)
        ];
        
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ 
            color: 0xffaa00, 
            linewidth: 2,
            transparent: true,
            opacity: 0.7
        });
        
        state.previewLine = new THREE.Line(geometry, material);
        state.scene.add(state.previewLine);
    }
}

// New function to clear preview line
function clearPreviewLine() {
    if (state.previewLine) {
        state.scene.remove(state.previewLine);
        state.previewLine = null;
    }
}

// New function to create filled shape
function createFilledShape(points) {
    try {
        const shape = new THREE.Shape();
        points.forEach((p, i) => {
            if (i === 0) {
                shape.moveTo(p.x, p.z);
            } else {
                shape.lineTo(p.x, p.z);
            }
        });

        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x74a9d8, // Light blue similar to extrusion
            transparent: true, 
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI/2;
        mesh.position.y = 0.05; // Slightly above ground plane
        mesh.receiveShadow = true;
        
        // Add custom property to identify this as a clickable shape
        mesh.userData.isClickableShape = true;
        mesh.userData.shapePoints = [...points]; // Store points for extrusion
        
        return mesh;
    } catch (error) {
        console.error('Error creating filled shape:', error);
        return null;
    }
}

function setupDrawing() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const threshold = 3.0;

    state.renderer.domElement.addEventListener('click', event => {
        // Handle shape clicking for extrusion when not in drawing mode
        if (!state.isDrawing) {
            const rect = state.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, state.camera);
            const intersects = raycaster.intersectObjects(state.shapeMeshes);
            
            if (intersects.length > 0) {
                const clickedShape = intersects[0].object;
                if (clickedShape.userData.isClickableShape) {
                    const height = parseFloat(document.getElementById('heightInput').value);
                    if (height > 0) {
                        extrudeShape(clickedShape, height);
                    } else {
                        alert('Please set a valid height before clicking to extrude');
                    }
                }
            }
            return;
        }

        // Original drawing logic
        if (!state.isDrawing || event.button !== 0 || !state.plane) return;

        const rect = state.renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, state.camera);
        const intersects = raycaster.intersectObject(state.plane);
        if (!intersects.length) return;

        const point = intersects[0].point;
        
        // Check if clicking near the first point to close polygon
        if (state.points.length > 2 && point.distanceTo(state.points[0]) < threshold) {
            state.isDrawing = false;
            clearPreviewLine();
            
            document.getElementById('startDraw').textContent = 'Start Drawing';
            document.getElementById('startDraw').style.background = '#3498db';
            document.getElementById('drawStatus').textContent = `Shape completed - ${state.points.length} points. Click shape to extrude or start new drawing.`;
            document.getElementById('drawStatus').className = 'draw-status inactive';
            
            // Add final line to close the polygon
            if (state.points.length > 2) {
                const finalPoints = [...state.points, state.points[0]];
                const geometry = new THREE.BufferGeometry().setFromPoints(
                    finalPoints.map(p => new THREE.Vector3(p.x, 0.1, p.z))
                );
                
                if (state.lineMeshes.length > 0) {
                    state.scene.remove(state.lineMeshes[state.lineMeshes.length - 1]);
                    state.lineMeshes.pop();
                }
                
                const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ 
                    color: 0xff6b6b, 
                    linewidth: 2 
                }));
                state.scene.add(line);
                state.lineMeshes.push(line);

                // Create filled shape
                const filledShape = createFilledShape(state.points);
                if (filledShape) {
                    state.scene.add(filledShape);
                    state.shapeMeshes.push(filledShape);
                }
            }
            
            // Reset points for next drawing
            state.points = [];
            return;
        }

        // Add new point
        state.points.push(point);
        
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 12, 8), 
            new THREE.MeshLambertMaterial({ color: 0xff6b6b })
        );
        sphere.position.copy(point);
        sphere.position.y = 0.5;
        sphere.castShadow = true;
        state.scene.add(sphere);
        state.pointMeshes.push(sphere);

        // Update line
        if (state.points.length > 1) {
            if (state.lineMeshes.length > 0) {
                state.scene.remove(state.lineMeshes[state.lineMeshes.length - 1]);
                state.lineMeshes.pop();
            }
            
            const geometry = new THREE.BufferGeometry().setFromPoints(
                state.points.map(p => new THREE.Vector3(p.x, 0.1, p.z))
            );
            const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ 
                color: 0xff6b6b, 
                linewidth: 2 
            }));
            state.scene.add(line);
            state.lineMeshes.push(line);
        }

        // Update status
        document.getElementById('drawStatus').textContent = 
            `${state.points.length} points placed - Click near first point to close shape`;
    });
}

// New function to extrude a specific shape
function extrudeShape(shapeMesh, height) {
    const points = shapeMesh.userData.shapePoints;
    
    try {
        const shape = new THREE.Shape();
        points.forEach((p, i) => {
            if (i === 0) {
                shape.moveTo(p.x, p.z);
            } else {
                shape.lineTo(p.x, p.z);
            }
        });
        
        const extrudeSettings = {
            depth: height,
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x4a90e2, 
            transparent: true, 
            opacity: 0.8 
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height;
        mesh.rotation.x = Math.PI/2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        state.scene.add(mesh);
        
        // Remove the flat shape since it's now extruded
        state.scene.remove(shapeMesh);
        const shapeIndex = state.shapeMeshes.indexOf(shapeMesh);
        if (shapeIndex > -1) {
            state.shapeMeshes.splice(shapeIndex, 1);
        }
        
        document.getElementById('drawStatus').textContent = `Building created! Height: ${height}m. Click other shapes to extrude or draw new ones.`;
    } catch (error) {
        console.error('Error extruding shape:', error);
        alert('Error creating building. Try drawing a simpler shape.');
    }
}

function extrudePolygon(height) {
    if (state.points.length < 3) {
        alert('Need at least 3 points to create a building');
        return;
    }

    try {
        const shape = new THREE.Shape();
        state.points.forEach((p, i) => {
            if (i === 0) {
                shape.moveTo(p.x, p.z);
            } else {
                shape.lineTo(p.x, p.z);
            }
        });
        
        const extrudeSettings = {
            depth: height,
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x4a90e2, 
            transparent: true, 
            opacity: 0.8 
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height;
        mesh.rotation.x = Math.PI/2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        state.scene.add(mesh);
        
        document.getElementById('drawStatus').textContent = `Building created! Height: ${height}m`;
    } catch (error) {
        console.error('Error creating building:', error);
        alert('Error creating building. Try drawing a simpler shape.');
    }
}

function animate() {
    requestAnimationFrame(animate);
    state.renderer.render(state.scene, state.camera);
}

function getUserLocationAndInit() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const { longitude, latitude } = position.coords;
            initScene([longitude, latitude]);
        }, () => {
            console.warn('Geolocation failed. Using San Francisco coordinates.');
            initScene([-122.4442, 37.7354]);
        });
    } else {
        console.warn('Geolocation not supported. Using San Francisco coordinates.');
        initScene([-122.4442, 37.7354]);
    }
}

// Initialize
getUserLocationAndInit();

// Event listeners
document.getElementById('startDraw').addEventListener('click', () => {
    if (!state.plane) {
        alert('Please wait for the map to load before drawing');
        return;
    }
    
    state.isDrawing = !state.isDrawing;
    const btn = document.getElementById('startDraw');
    const status = document.getElementById('drawStatus');
    
    if (state.isDrawing) {
        btn.textContent = 'Stop Drawing';
        btn.style.background = '#e74c3c';
        status.textContent = 'Drawing mode active - Click to place points';
        status.className = 'draw-status active';
    } else {
        btn.textContent = 'Start Drawing';
        btn.style.background = '#3498db';
        status.textContent = `Drawing stopped - ${state.points.length} points placed`;
        status.className = 'draw-status inactive';
        clearPreviewLine(); // Clear preview line when stopping drawing
    }
});

document.getElementById('extrude').addEventListener('click', () => {
    const height = parseFloat(document.getElementById('heightInput').value);
    if (height > 0) {
        extrudePolygon(height);
    } else {
        alert('Please enter a valid height greater than 0');
    }
});

document.getElementById('reset').addEventListener('click', () => {
    if (confirm('Reset the entire scene? This will clear all your work.')) {
        location.reload();
    }
});