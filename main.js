const mapboxgl = { accessToken: 'pk.eyJ1IjoidG9oZWVyIiwiYSI6ImNtYW5uMGpwNjAwb2cyanF4ODJxcHg0M20ifQ.9ycLcAqj1-dfw1j9zjbhZA' };

let state = {
    scene: null,
    camera: null,
    renderer: null,
    plane: null,
    points: [],
    pointMeshes: [],
    lineMeshes: [],
    shapeMeshes: [], // For both flat and extruded shapes
    previewLine: null,
    closingPreviewLine: null,
    isDrawing: false,
    currentMapCenter: [-122.4442, 37.7354], // Default to SF, will be updated by geolocation
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
    state.currentMapCenter = center; // Store the initial center
    updateProjectAddress(center); // Get and display address
    generateSiteModelThumbnails(center); // Generate initial site model images

    const container = document.getElementById('three-canvas');
    if (!container) {
        console.error('Three.js canvas container not found!');
        return;
    }
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
    renderer.setClearColor(0xf0f0f0, 1); // Light grey, fully opaque background
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
    // Mapbox Static Images API URL format:
    // https://api.mapbox.com/styles/v1/{username}/{style_id}/static/{lon},{lat},{zoom},{bearing},{pitch}/{width}x{height}{@2x}?access_token={access_token}
    const mapboxStaticUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${center[0]},${center[1]},19.5/1024x1024?access_token=${mapboxgl.accessToken}`;
    
    loader.load(mapboxStaticUrl, texture => {
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100), // Adjust size based on desired scale
            new THREE.MeshLambertMaterial({ map: texture })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        scene.add(plane);
        state.plane = plane;
        
        document.getElementById('drawStatus').textContent = 'Map loaded - Click pen icon to begin drawing';
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
        
        document.getElementById('drawStatus').textContent = 'Fallback mode - Click pen icon to begin drawing';
    });

    state.scene = scene;
    state.renderer = renderer;

    setupControls();
    setupDrawing();

    window.addEventListener('resize', () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
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
            // Update preview lines while drawing
            updatePreviewLines(e);
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

function updatePreviewLines(event) {
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
        
        clearPreviewLines();
        
        // 1. Line from last point to mouse (current drawing line)
        if (state.points.length >= 1) {
            const lastPoint = state.points[state.points.length - 1];
            const currentLinePoints = [
                new THREE.Vector3(lastPoint.x, 0.15, lastPoint.z),
                new THREE.Vector3(mousePoint.x, 0.15, mousePoint.z)
            ];
            
            const currentGeometry = new THREE.BufferGeometry().setFromPoints(currentLinePoints);
            const currentMaterial = new THREE.LineBasicMaterial({ 
                color: 0xffaa00, 
                linewidth: 2,
                transparent: true,
                opacity: 0.7
            });
            
            state.previewLine = new THREE.Line(currentGeometry, currentMaterial);
            state.scene.add(state.previewLine);
        }
        
        // 2. Dashed line from mouse back to first point (closing line)
        if (state.points.length >= 2) {
            const firstPoint = state.points[0];
            const closingLinePoints = [
                new THREE.Vector3(mousePoint.x, 0.15, mousePoint.z),
                new THREE.Vector3(firstPoint.x, 0.15, firstPoint.z)
            ];
            
            const closingGeometry = new THREE.BufferGeometry().setFromPoints(closingLinePoints);
            const closingMaterial = new THREE.LineDashedMaterial({
                color: 0x888888,
                linewidth: 1,
                dashSize: 1,
                gapSize: 0.5,
                transparent: true,
                opacity: 0.6
            });
            
            state.closingPreviewLine = new THREE.Line(closingGeometry, closingMaterial);
            state.closingPreviewLine.computeLineDistances(); // Required for dashed lines
            state.scene.add(state.closingPreviewLine);
        }
    }
}

function clearPreviewLines() {
    if (state.previewLine) {
        state.scene.remove(state.previewLine);
        state.previewLine = null;
    }
    if (state.closingPreviewLine) {
        state.scene.remove(state.closingPreviewLine);
        state.closingPreviewLine = null;
    }
}

// New function to update the Z-coordinate (or Y in Three.js context for points/lines on XZ plane)
function raiseDrawingElements(height) {
    // Raise points (spheres)
    state.pointMeshes.forEach(mesh => {
        mesh.position.y = height + 0.5; // New height + half sphere radius
        // Ensure sphere also casts shadow from new height
        mesh.castShadow = true; 
    });

    // Raise lines
    state.lineMeshes.forEach(line => {
        const positions = line.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) { // Y-coordinate is at index 1, 4, 7...
            positions[i] = height + 0.1; // New height + small offset for line visibility
        }
        line.geometry.attributes.position.needsUpdate = true; // Tell Three.js to update buffer
    });
}


function setupDrawing() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const threshold = 3.0; // Distance threshold for closing a polygon

    state.renderer.domElement.addEventListener('click', event => {
        // Prevent drawing/extrusion if sidebar toggle is clicked or other UI elements
        if (event.target.closest('#startDraw, #extrude, #reset, #heightInput')) return;

        // Handle shape clicking for extrusion when not in drawing mode
        if (!state.isDrawing) {
            const rect = state.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, state.camera);
            const intersects = raycaster.intersectObjects(state.shapeMeshes);
            
            if (intersects.length > 0) {
                const clickedShape = intersects[0].object;
                // Only extrude if it's a flat shape ready for extrusion
                if (clickedShape.userData.isClickableShape && !clickedShape.userData.isExtruded) {
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
            clearPreviewLines(); // Clear all preview lines
            
            document.getElementById('startDraw').classList.remove('active');
            document.getElementById('drawStatus').textContent = `Shape completed - ${state.points.length} points. Click shape to extrude or click pen to draw new.`;
            document.getElementById('drawStatus').className = 'draw-status inactive';
            
            // Add final line to close the polygon
            if (state.points.length > 2) {
                // Remove the last line segment that was dynamically updated
                // No need to remove it if we're keeping all lines/points until extrusion
                
                // Add the final closing line segment explicitly
                const lastPoint = state.points[state.points.length - 1];
                const firstPoint = state.points[0];
                const closingLineGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(lastPoint.x, 0.1, lastPoint.z),
                    new THREE.Vector3(firstPoint.x, 0.1, firstPoint.z)
                ]);
                const closingLine = new THREE.Line(closingLineGeometry, new THREE.LineBasicMaterial({ 
                    color: 0xff6b6b, 
                    linewidth: 2 
                }));
                state.scene.add(closingLine);
                state.lineMeshes.push(closingLine);

                // Create filled shape
                const filledShape = createFilledShape(state.points);
                if (filledShape) {
                    state.scene.add(filledShape);
                    state.shapeMeshes.push(filledShape);
                }
            }
            // Do NOT reset points and point/line meshes here.
            // They need to be maintained until extrusion.
            return;
        }

        // Add new point
        const newPoint = new THREE.Vector3(point.x, 0.1, point.z); // Store with a slight Y offset
        state.points.push(newPoint);
        
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 12, 8), 
            new THREE.MeshLambertMaterial({ color: 0xff6b6b })
        );
        sphere.position.copy(point);
        sphere.position.y = 0.5; // Slightly above ground
        sphere.castShadow = true;
        state.scene.add(sphere);
        state.pointMeshes.push(sphere);

        // Update line (only add new segment from previous point to current)
        if (state.points.length > 1) {
            const lastPoint = state.points[state.points.length - 2]; // Second to last
            const currentPoint = state.points[state.points.length - 1]; // Last
            
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(lastPoint.x, 0.1, lastPoint.z),
                new THREE.Vector3(currentPoint.x, 0.1, currentPoint.z)
            ]);
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

// New function to create filled shape
function createFilledShape(points) {
    try {
        const shape = new THREE.Shape();
        points.forEach((p, i) => {
            if (i === 0) {
                shape.moveTo(p.x, p.z); // Use p.x and p.z as the 2D coordinates for the shape
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
        mesh.position.y = 0.05; // Slightly above ground
        mesh.receiveShadow = true;
        
        // Add custom property to identify this as a clickable shape
        mesh.userData.isClickableShape = true;
        mesh.userData.isExtruded = false; // Flag to indicate if it's already extruded
        mesh.userData.shape = shape; // Store the THREE.Shape object itself
        mesh.userData.shapePoints = [...points]; // Store original points for reference

        // Store references to the points and lines associated with this shape
        mesh.userData.associatedPoints = [...state.pointMeshes];
        mesh.userData.associatedLines = [...state.lineMeshes];
        
        return mesh;
    } catch (error) {
        console.error('Error creating filled shape:', error);
        return null;
    }
}

// New function to extrude a specific shape
function extrudeShape(shapeMesh, height) {
    const shape = shapeMesh.userData.shape; // Get the original THREE.Shape
    
    try {
        const extrudeSettings = {
            depth: -height, // Use positive height for upward extrusion
            bevelEnabled: false
        };
        
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const material = new THREE.MeshLambertMaterial({ 
            color: 0x4a90e2, 
            // transparent: true, 
            opacity: 1
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        // Extrusion happens along the Z-axis of the shape, so we need to adjust
        mesh.position.y = 0; // The base of the extrusion is at Y=0
        mesh.rotation.x = Math.PI/2; // Orient it correctly with the ground plane
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        state.scene.add(mesh);
        
        // Remove the flat shape since it's now extruded
        state.scene.remove(shapeMesh);
        const shapeIndex = state.shapeMeshes.indexOf(shapeMesh);
        if (shapeIndex > -1) {
            state.shapeMeshes.splice(shapeIndex, 1); // Remove the old flat shape
        }
        
        // Add the new extruded mesh to tracked shapes
        mesh.userData.isExtruded = true; // Mark as extruded
        state.shapeMeshes.push(mesh); 

        // Raise the associated points and lines to the extrusion height
        // Get the associated points/lines from the shapeMesh's userData
        const associatedPoints = shapeMesh.userData.associatedPoints || [];
        const associatedLines = shapeMesh.userData.associatedLines || [];

        associatedPoints.forEach(pMesh => {
            pMesh.position.y = height + 0.5;
            pMesh.castShadow = true;
        });

        associatedLines.forEach(line => {
            const positions = line.geometry.attributes.position.array;
            for (let i = 1; i < positions.length; i += 3) { // Y-coordinate is at index 1, 4, 7...
                positions[i] = height + 0.1;
            }
            line.geometry.attributes.position.needsUpdate = true;
        });


        // Clear global state points and lines after extrusion
        state.points = [];
        state.pointMeshes = [];
        state.lineMeshes = [];
        
        document.getElementById('drawStatus').textContent = `Building created! Height: ${height}m. Click other shapes to extrude or draw new ones.`;
    } catch (error) {
        console.error('Error extruding shape:', error);
        alert('Error creating building. Try drawing a simpler shape.');
    }
}

function animate() {
    requestAnimationFrame(animate);
    state.renderer.render(state.scene, state.camera);
}

// --- New and Modified Functions for Address and Site Models ---

async function updateProjectAddress(coordinates) {
    const [lon, lat] = coordinates;
    const projectAddressElement = document.getElementById('projectAddress');
    projectAddressElement.textContent = 'Fetching address...';

    try {
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${mapboxgl.accessToken}`);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            projectAddressElement.textContent = data.features[0].place_name;
        } else {
            projectAddressElement.textContent = `Address not found for ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        }
    } catch (error) {
        console.error('Error fetching address:', error);
        projectAddressElement.textContent = `Error fetching address for ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
}

function generateSiteModelThumbnails(baseCoordinates) {
    const siteModelsContainer = document.getElementById('siteModelsContainer');
    siteModelsContainer.innerHTML = ''; // Clear existing thumbnails

    // Generate a few slightly offset coordinates for different "models"
    const offsets = [
        [0, 0],       // Original location
        [0.0005, 0],  // Slightly east
        [0, 0.0005],  // Slightly north
        [-0.0005, 0.0005] // Slightly NW
    ];

    offsets.forEach((offset, index) => {
        const [lonOffset, latOffset] = offset;
        const modelLon = baseCoordinates[0] + lonOffset;
        const modelLat = baseCoordinates[1] + latOffset;

        const thumbnailUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${modelLon},${modelLat},18/150x100?access_token=${mapboxgl.accessToken}`;
        
        const thumbDiv = document.createElement('div');
        thumbDiv.className = 'site-model-thumb';
        thumbDiv.innerHTML = `
            <img src="${thumbnailUrl}" alt="Site Model ${index + 1}">
            <span>Site Model ${index + 1}</span>
        `;
        siteModelsContainer.appendChild(thumbDiv);
    });
}

function getUserLocationAndInit() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const { longitude, latitude } = position.coords;
            initScene([longitude, latitude]);
        }, (error) => {
            console.warn('Geolocation failed:', error);
            document.getElementById('projectAddress').textContent = 'Geolocation denied/failed. Using default location.';
            initScene([-122.4442, 37.7354]); // San Francisco coordinates
        });
    } else {
        console.warn('Geolocation not supported. Using San Francisco coordinates.');
        document.getElementById('projectAddress').textContent = 'Geolocation not supported. Using default location.';
        initScene([-122.4442, 37.7354]); // San Francisco coordinates
    }
}

// Function to format the date
function getFormattedDate(date) {
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return new Date(date).toLocaleDateString('en-US', options);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    getUserLocationAndInit();

    // Event listeners for UI buttons
    const startDrawButton = document.getElementById('startDraw');
    startDrawButton.addEventListener('click', () => {
        if (!state.plane) {
            alert('Please wait for the map to load before drawing');
            return;
        }
        
        state.isDrawing = !state.isDrawing;
        const status = document.getElementById('drawStatus');
        
        if (state.isDrawing) {
            startDrawButton.classList.add('active');
            status.textContent = 'Drawing mode active - Click to place points';
            status.className = 'draw-status active';

            // Clear any existing drawing lines and points when starting new drawing
            // These were not cleared when drawing finished, so clear them now for a new drawing
            state.lineMeshes.forEach(mesh => state.scene.remove(mesh));
            state.lineMeshes = [];
            state.pointMeshes.forEach(mesh => state.scene.remove(mesh));
            state.pointMeshes = [];
            state.points = []; // Clear points
            clearPreviewLines();

        } else {
            startDrawButton.classList.remove('active');
            status.textContent = `Drawing stopped - ${state.points.length} points placed`;
            status.className = 'draw-status inactive';
            clearPreviewLines(); // Clear all preview lines when stopping drawing
        }
    });

    document.getElementById('extrude').addEventListener('click', () => {
        const height = parseFloat(document.getElementById('heightInput').value);
        if (height > 0) {
            // If in drawing mode and points exist, extrude the current polygon
            if (state.isDrawing && state.points.length >= 3) {
                // Manually close the polygon if extrude is clicked during drawing
                const lastPoint = state.points[state.points.length - 1];
                const firstPoint = state.points[0];
                const closingLineGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(lastPoint.x, 0.1, lastPoint.z),
                    new THREE.Vector3(firstPoint.x, 0.1, firstPoint.z)
                ]);
                const closingLine = new THREE.Line(closingLineGeometry, new THREE.LineBasicMaterial({ 
                    color: 0xff6b6b, 
                    linewidth: 2 
                }));
                state.scene.add(closingLine);
                state.lineMeshes.push(closingLine);

                const filledShape = createFilledShape(state.points);
                if (filledShape) {
                    state.scene.add(filledShape);
                    state.shapeMeshes.push(filledShape);
                    extrudeShape(filledShape, height); // Extrude the newly created shape
                }
                
                // Reset drawing state
                state.isDrawing = false;
                startDrawButton.classList.remove('active');
                clearPreviewLines();
                // Points and lines will be cleared by extrudeShape after they are raised

            } else if (!state.isDrawing && state.shapeMeshes.length > 0) {
                alert('Please click on a flat shape in the scene to extrude it.');
            } else {
                alert('Please draw at least 3 points to form a polygon before extruding.');
            }
        } else {
            alert('Please enter a valid height greater than 0');
        }
    });

    document.getElementById('reset').addEventListener('click', () => {
        if (confirm('Reset the entire scene? This will clear all your work.')) {
            // Remove all custom meshes from the scene
            state.pointMeshes.forEach(mesh => state.scene.remove(mesh));
            state.pointMeshes = [];
            state.lineMeshes.forEach(mesh => state.scene.remove(mesh));
            state.lineMeshes = [];
            state.shapeMeshes.forEach(mesh => state.scene.remove(mesh));
            state.shapeMeshes = []; // Clear flat and extruded shapes
            
            // Also explicitly remove any extruded buildings if they weren't removed by shapeMeshes clearing
            // This is a safety net in case of mixed object types in shapeMeshes array
            state.scene.children.filter(obj => obj.geometry && obj.geometry.type === 'ExtrudeGeometry')
                          .forEach(obj => state.scene.remove(obj));

            state.points = [];
            state.isDrawing = false;
            clearPreviewLines();
            startDrawButton.classList.remove('active');
            document.getElementById('drawStatus').textContent = 'Scene reset. Click pen icon to begin drawing.';
            document.getElementById('drawStatus').className = 'draw-status inactive';
        }
    });

    // Update the project created date
    const projectCreatedDateElement = document.getElementById('projectCreatedDate');
    if (projectCreatedDateElement) {
        const today = new Date();
        projectCreatedDateElement.textContent = `Created ${getFormattedDate(today)}`;
    }
});