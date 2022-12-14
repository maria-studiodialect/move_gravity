/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-webgpu';
import * as mpPose from '@mediapipe/pose';

import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';

tfjsWasm.setWasmPaths(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${tfjsWasm.version_wasm}/dist/`);

import * as posedetection from '@tensorflow-models/pose-detection';

import { Camera } from './camera';
import { setupDatGui } from './option_panel';
import { STATE } from './params';
import { setupStats } from './stats_panel';
import { setBackendAndEnvFlags } from './util';

let detector, camera, stats;
let startInferenceTime, numInferences = 0;
let inferenceTimeSum = 0, lastPanelUpdate = 0;
let rafId;
let poses;


async function createDetector() {
  switch (STATE.model) {
    case posedetection.SupportedModels.PoseNet:
      return posedetection.createDetector(STATE.model, {
        quantBytes: 4,
        architecture: 'MobileNetV1',
        outputStride: 16,
        inputResolution: { width: 500, height: 500 },
        multiplier: 0.75
      });
    case posedetection.SupportedModels.BlazePose:
      const runtime = STATE.backend.split('-')[0];
      if (runtime === 'mediapipe') {
        return posedetection.createDetector(STATE.model, {
          runtime,
          modelType: STATE.modelConfig.type,
          solutionPath: `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${mpPose.VERSION}`
        });
      } else if (runtime === 'tfjs') {
        return posedetection.createDetector(
          STATE.model, { runtime, modelType: STATE.modelConfig.type });
      }
    case posedetection.SupportedModels.MoveNet:
      let modelType;
      if (STATE.modelConfig.type == 'lightning') {
        modelType = posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
      } else if (STATE.modelConfig.type == 'thunder') {
        modelType = posedetection.movenet.modelType.SINGLEPOSE_THUNDER;
      } else if (STATE.modelConfig.type == 'multipose') {
        modelType = posedetection.movenet.modelType.MULTIPOSE_LIGHTNING;
      }
      const modelConfig = { modelType };

      if (STATE.modelConfig.customModel !== '') {
        modelConfig.modelUrl = STATE.modelConfig.customModel;
      }
      if (STATE.modelConfig.type === 'multipose') {
        modelConfig.enableTracking = STATE.modelConfig.enableTracking;
      }
      return posedetection.createDetector(STATE.model, modelConfig);
  }
}

async function checkGuiUpdate() {
  if (STATE.isTargetFPSChanged || STATE.isSizeOptionChanged) {
    camera = await Camera.setupCamera(STATE.camera);
    STATE.isTargetFPSChanged = false;
    STATE.isSizeOptionChanged = false;
  }

  if (STATE.isModelChanged || STATE.isFlagChanged || STATE.isBackendChanged) {
    STATE.isModelChanged = true;

    window.cancelAnimationFrame(rafId);

    if (detector != null) {
      detector.dispose();
    }

    if (STATE.isFlagChanged || STATE.isBackendChanged) {
      await setBackendAndEnvFlags(STATE.flags, STATE.backend);
    }

    try {
      detector = await createDetector(STATE.model);
    } catch (error) {
      detector = null;
      alert(error);
    }

    STATE.isFlagChanged = false;
    STATE.isBackendChanged = false;
    STATE.isModelChanged = false;
  }
}

function beginEstimatePosesStats() {
  startInferenceTime = (performance || Date).now();
}

function endEstimatePosesStats() {
  const endInferenceTime = (performance || Date).now();
  inferenceTimeSum += endInferenceTime - startInferenceTime;
  ++numInferences;

  const panelUpdateMilliseconds = 1000;
  if (endInferenceTime - lastPanelUpdate >= panelUpdateMilliseconds) {
    const averageInferenceTime = inferenceTimeSum / numInferences;
    inferenceTimeSum = 0;
    numInferences = 0;
    stats.customFpsPanel.update(
      1000.0 / averageInferenceTime, 120 /* maxValue */);
    lastPanelUpdate = endInferenceTime;
  }
}

async function renderResult() {
  if (camera.video.readyState < 2) {
    await new Promise((resolve) => {
      camera.video.onloadeddata = () => {
        resolve(video);
      };
    });
  }

  //let poses = null;

  // Detector can be null if initialization failed (for example when loading
  // from a URL that does not exist).
  if (detector != null) {
    // FPS only counts the time it takes to finish estimatePoses.
    beginEstimatePosesStats();

    // Detectors can throw errors, for example when using custom URLs that
    // contain a model that doesn't provide the expected output.
    try {
      poses = await detector.estimatePoses(
        camera.video,
        { maxPoses: STATE.modelConfig.maxPoses, flipHorizontal: false });
    } catch (error) {
      detector.dispose();
      detector = null;
      alert(error);
    }

    endEstimatePosesStats();
  }

  camera.drawCtx();

  // The null check makes sure the UI is not in the middle of changing to a
  // different model. If during model change, the result is from an old model,
  // which shouldn't be rendered.
  if (poses && poses.length > 0 && !STATE.isModelChanged) {
    camera.drawResults(poses);
    usePoses(poses);
  }

}

async function renderPrediction() {
  await checkGuiUpdate();

  if (!STATE.isModelChanged) {
    await renderResult();
  }
  rafId = requestAnimationFrame(renderPrediction);
};

async function app() {
  // Gui content will change depending on which model is in the query string.
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('model')) {
    //alert('Cannot find model in the query string.');
    urlParams.set('model', 'movenet');
    window.location.search = urlParams;
    return;
  }
  await setupDatGui(urlParams);

  stats = setupStats();

  camera = await Camera.setupCamera(STATE.camera);

  await setBackendAndEnvFlags(STATE.flags, STATE.backend);

  detector = await createDetector();

  renderPrediction();
};


app();



const usePoses = (poses) => {
  
  const Body = m.Body;
  const attractiveBody = m.attractiveBody;

  const imageSize = {width: 1280, height: 720}

  function flipPosesHorizontal(poses, imageSize) {
      for (var _i = 0, poses_1 = poses; _i < poses_1.length; _i++) {
          var pose = poses_1[_i];
          for (var _a = 0, _b = pose.keypoints; _a < _b.length; _a++) {
              var kp = _b[_a];
              kp.x = imageSize.width - 1 - kp.x;
          }
      }
      return poses;
  }

  flipPosesHorizontal(poses, imageSize);
  
  const pose = poses[0].keypoints[10];

  const score = pose.score != null ? pose.score : 1;
  const scoreThreshold = 0.3 || 0;

  if (score >= scoreThreshold) {
    Body.translate(attractiveBody, {
      x: ((pose.x * 2.4) - attractiveBody.position.x),
      y: ((pose.y * 2.4) - attractiveBody.position.y)
    });
  }
}



var canvas = $("#wrapper-canvas").get(0);

var dimensions = {
  width: 3072,
  height: 1728
};

Matter.use('matter-attractors');
Matter.use('matter-wrap');


function runMatter(choice) {
  // module aliases
  var Engine = Matter.Engine,
    Events = Matter.Events,
    Runner = Matter.Runner,
    Render = Matter.Render,
    World = Matter.World,
    Body = Matter.Body,
    Mouse = Matter.Mouse,
    Common = Matter.Common,
    Composite = Matter.Composite,
    Composites = Matter.Composites,
    Constraint = Matter.Constraint,
    Bodies = Matter.Bodies;

  // create engine
  var engine = Engine.create();



  // create renderer
  var render = Render.create({
    element: canvas,
    engine: engine,
    options: {
      showVelocity: false,
      width: dimensions.width,
      height: dimensions.height,
      wireframes: false,
      background: '#B0B1B'
    }
  });

  // create runner
  var runner = Runner.create();

  // Runner.run(runner, engine);
  // Render.run(render);


  switch (choice) {
    case 1:
      engine.world.gravity.y = 0
      engine.world.gravity.x = 0
      engine.world.gravity.scale = 0.1
        // create demo scene
      var world = engine.world;
      world.gravity.scale = 0;

  // create a body with an attractor
  var attractiveBody = Bodies.circle(
    render.options.width / 2,
    render.options.height / 2,
    (Math.max(dimensions.width / 10, dimensions.height / 10)) / 2,
    {
      render: {
        fillStyle: `#B0B1B3`,
        strokeStyle: `rgba(255, 255, 255, 0.2)`,
        lineWidth: 3,
      },
      isStatic: true,
      plugin: {
        attractors: [
          function (bodyA, bodyB) {
            return {
              x: (bodyA.position.x - bodyB.position.x) * 1e-6,
              y: (bodyA.position.y - bodyB.position.y) * 1e-6,
            };
          }
        ]
      }
    });

  World.add(world, attractiveBody);

  var radius = 20
  // art & design
  var illustration = Bodies.rectangle(600, 500, (237*2), (80*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/01.png', xScale: 1, yScale: 1 } } })
  var art = Bodies.rectangle(35, 460, (288*2), (75*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/02.png', xScale: 1, yScale: 1 } } })
  var threeD = Bodies.rectangle(90, 460, (307*2), (59*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/03.png', xScale: 1, yScale: 1 } } })
  var graphic = Bodies.rectangle(60, 420, (223*2), (60*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/04.png', xScale: 1, yScale: 1 } } })
  var photo = Bodies.rectangle(50, 380, (174*2), (62*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/05.png', xScale: 1, yScale: 1 } } })
  // video
  var documentary = Bodies.rectangle(220, 540, (238*2), (59*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/06.png', xScale: 1, yScale: 1 } } })
  var animation = Bodies.rectangle(200, 490, (200*2), (70*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/07.png', xScale: 1, yScale: 1 } } })
  var play = Bodies.rectangle(190, 440, (208*2), (71*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/08.png', xScale: 1, yScale: 1 } } })
  var climb = Bodies.rectangle(190, 440, (249*2), (62*2), { chamfer: { radius: radius }, mass: 0.1, friction: 0, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/09.png', xScale: 1, yScale: 1 } } })
  
  var danceD = Bodies.rectangle((100*3.5), 950, (61*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Dance-d.png', xScale: 2.5, yScale: 2.5 } } })
  var danceA = Bodies.rectangle((191.5*3.5), 950, (62*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Dance-a.png', xScale: 2.5, yScale: 2.5 } } })
   var danceN = Bodies.rectangle((284.5*3.5), 950, (56*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Dance-n.png', xScale: 2.5, yScale: 2.5 } } })
    var danceC = Bodies.rectangle((368.5*3.5), 950, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Dance-c.png', xScale: 2.5, yScale: 2.5 } } })
     var danceE = Bodies.rectangle((458.5*3.5), 950, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Dance-e.png', xScale: 2.5, yScale: 2.5 } } })
     
     var dance2D = Bodies.rectangle((100*3.5), 200, (61*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Bend-&.png', xScale: 2.5, yScale: 2.5 } } })
     var dance2A = Bodies.rectangle((191.5*3.5), 200, (62*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Bend-B.png', xScale: 2.5, yScale: 2.5 } } })
      var dance2N = Bodies.rectangle((284.5*3.5), 200, (56*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Bend-e.png', xScale: 2.5, yScale: 2.5 } } })
       var dance2C = Bodies.rectangle((368.5*3.5), 200, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Bend-n.png', xScale: 2.5, yScale: 2.5 } } })
        var dance2E = Bodies.rectangle((458.5*3.5), 200, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Bend-d.png', xScale: 2.5, yScale: 2.5 } } })
        
  //Sprint
     var sprintAnd = Bodies.rectangle(548.5, 650, (67*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-&.png', xScale: 2.5, yScale: 2.5 } } })
     var sprintS = Bodies.rectangle(649, 650, (55*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-S.png', xScale: 2.5, yScale: 2.5 } } })
   var sprintP = Bodies.rectangle(731.5, 650, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-p.png', xScale: 2.5, yScale: 2.5 } } })
  var sprintR = Bodies.rectangle(821.5, 650, (36*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-r.png', xScale: 2.5, yScale: 2.5 } } })
   var sprintI = Bodies.rectangle(875.5, 650, (18*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-i.png', xScale: 2.5, yScale: 2.5 } } })
    var sprintN = Bodies.rectangle(902.5, 650, (55*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-n.png', xScale: 2.5, yScale: 2.5 } } })
     var sprintT = Bodies.rectangle(985, 650, (38*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Sprint-t.png', xScale: 2.5, yScale: 2.5 } } })
     
  //Stretch
     var stretchAnd = Bodies.rectangle(1042, 650, (67*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-&.png', xScale: 2.5, yScale: 2.5 } } })
     var stretchS = Bodies.rectangle(1142.5, 650, (53*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-S.png', xScale: 2.5, yScale: 2.5 } } })
   var stretchT = Bodies.rectangle(1222, 650, (40*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-t.png', xScale: 2.5, yScale: 2.5 } } })
  var stretchR = Bodies.rectangle(1282, 650, (32*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-r.png', xScale: 2.5, yScale: 2.5 } } })
   var stretchE = Bodies.rectangle(1330, 650, (55*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-e.png', xScale: 2.5, yScale: 2.5 } } })
    var stretchT2 = Bodies.rectangle(1412.5, 650, (40*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-t.png', xScale: 2.5, yScale: 2.5 } } })
     var stretchC = Bodies.rectangle(1472.5, 650, (57*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-c.png', xScale: 2.5, yScale: 2.5 } } })
     var stretchH = Bodies.rectangle(1558, 650, (57*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Stretch-h.png', xScale: 2.5, yScale: 2.5 } } })
      
     //Stretch
     var stretch2And = Bodies.rectangle((1042*2), 650, (65*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Jump-&.png', xScale: 2.5, yScale: 2.5 } } })
     var stretch2S = Bodies.rectangle((1142.5*2), 650, (52*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Jump-J.png', xScale: 2.5, yScale: 2.5 } } })
   var stretch2T = Bodies.rectangle((1222*2), 650, (54*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Jump-u.png', xScale: 2.5, yScale: 2.5 } } })
  var stretch2R = Bodies.rectangle((1282*2), 650, (85*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Jump-m.png', xScale: 2.5, yScale: 2.5 } } })
   var stretch2E = Bodies.rectangle((1330*2), 650, (60*2.5), (93*2.5), { mass: 0.8, friction: 0.1, frictionAir: 0.01, render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/Jump-p.png', xScale: 2.5, yScale: 2.5 } } })
     // add all bodies (boundaries and circles) to the world
        

  // add all of the bodies to the world
  World.add(world, [
    //illustration, art, threeD, graphic, photo, documentary, animation, play, climb
     danceD, danceA, danceN, danceC, danceE, dance2D, dance2A, dance2N, dance2C, dance2E,
     //sprintAnd, sprintS, sprintP, sprintI, sprintR, sprintN, sprintT, 
     stretchS, stretchAnd,  stretchT, stretchR,   stretchE, stretchT2,  stretchC,  stretchH, stretch2S, stretch2And,  stretch2T, stretch2R,   stretch2E
  ]);

  
    var cons1 = Constraint.create({bodyA: danceD, bodyB: danceA, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var cons2 = Constraint.create({bodyA: danceA, bodyB: danceN, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var cons3 = Constraint.create({bodyA: danceN, bodyB: danceC, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var cons4 = Constraint.create({bodyA: danceC, bodyB: danceE, length: (95*1.5), stiffness: 0.2, render: {visible:false}});

    var consD1 = Constraint.create({bodyA: dance2D, bodyB: dance2A, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var consD2 = Constraint.create({bodyA: dance2A, bodyB: dance2N, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var consD3 = Constraint.create({bodyA: dance2N, bodyB: dance2C, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var consD4 = Constraint.create({bodyA: dance2C, bodyB: dance2E, length: (95*1.5), stiffness: 0.2, render: {visible:false}});

    var cons5 = Constraint.create({bodyA: stretchAnd, bodyB: stretchS, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var cons6 = Constraint.create({bodyA: stretchS, bodyB: stretchT, length: (75*1.5), stiffness: 0.2, render: {visible:false}});
    var cons7 = Constraint.create({bodyA: stretchT, bodyB: stretchR, length: (70*1.4), stiffness: 0.2, render: {visible:false}});
    var cons8 = Constraint.create({bodyA: stretchR, bodyB: stretchE, length: (70*1.5), stiffness: 0.2, render: {visible:false}});
    var cons9 = Constraint.create({bodyA: stretchE, bodyB: stretchT2, length: (75*1.5), stiffness: 0.2, render: {visible:false}});
    var cons10 = Constraint.create({bodyA: stretchT2, bodyB: stretchC, length: (80*1.5), stiffness: 0.2, render: {visible:false}});
    var cons11 = Constraint.create({bodyA: stretchC, bodyB: stretchH, length: (95*1.5), stiffness: 0.2, render: {visible:false}});

    var consS5 = Constraint.create({bodyA: stretch2And, bodyB: stretch2S, length: (95*1.5), stiffness: 0.2, render: {visible:false}});
    var consS6 = Constraint.create({bodyA: stretch2S, bodyB: stretch2T, length: (90*1.5), stiffness: 0.2, render: {visible:false}});
    var consS7 = Constraint.create({bodyA: stretch2T, bodyB: stretch2R, length: (120*1.5), stiffness: 0.2, render: {visible:false}});
    var consS8 = Constraint.create({bodyA: stretch2R, bodyB: stretch2E, length: (120*1.5), stiffness: 0.2, render: {visible:false}});

    World.add(world, 
      [cons1, cons2, cons3, cons4, cons5, cons6, cons7, cons8, cons9, cons10, cons11, consD1, consD2, consD3, consD4, consS5, consS6, consS7, consS8
      // cons12, cons13, cons14, cons15, cons16, cons17
    ]);
    break;
    case 2:
      var world = engine.world;

      function percentX(percent) {
        return Math.round((percent / 100) * dimensions.width);
      }
      function percentY(percent) {
        return Math.round((percent / 100) * dimensions.height);
      }
      
      // return a random integer between two values, inclusive
      function getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1) + min);
      }


      var attractiveBody = Bodies.circle(
        render.options.width / 2,
        render.options.height / 2,
        (Math.max(dimensions.width / 10, dimensions.height / 10)) / 2,
        {
          render: {
            fillStyle: `#B0B1B3`,
            strokeStyle: `#B0B1B3`,
            lineWidth: 0
          },
          isStatic: true,
        });

        World.add(world, attractiveBody);

      let bodies = [];
      var ceiling = Bodies.rectangle(percentX(100) / 2, percentY(0) - 10, percentX(100), 20, { isStatic: true });
      var floor = Bodies.rectangle(percentX(100) / 2, percentY(100) + 10, percentX(100), 20, { isStatic: true });
      var rightWall = Bodies.rectangle(percentX(100) + 10, percentY(100) / 2, 20, percentY(100), { isStatic: true });
      var leftWall = Bodies.rectangle(percentX(0) - 10, percentY(100) / 2, 20, percentY(100), { isStatic: true });
      ceiling.render.visible = false;
      floor.render.visible = false;
      rightWall.render.visible = false;
      leftWall.render.visible = false;
      bodies.push(ceiling);
      bodies.push(floor);
      bodies.push(rightWall);
      bodies.push(leftWall);

      var dance = Bodies.rectangle(200, 0, 237, 80, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/01.png', xScale: 0.5, yScale: 0.5 } } })
      var sprint = Bodies.rectangle(250, 0, 288, 75, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/02.png', xScale: 0.5, yScale: 0.5 } } })
      var stretch = Bodies.rectangle(800, 0, 307, 59, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/03.png', xScale: 0.5, yScale: 0.5 } } })
      var push = Bodies.rectangle(600, 0, 223, 60, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/04.png', xScale: 0.5, yScale: 0.5 } } })
      var lift = Bodies.rectangle(800, 0, 174, 62, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/05.png', xScale: 0.5, yScale: 0.5 } } })
      // video
      var bend = Bodies.rectangle(120, 0, 238, 59, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/06.png', xScale: 0.5, yScale: 0.5 } } })
      var kick = Bodies.rectangle(500, 0, 200, 70, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/07.png', xScale: 0.5, yScale: 0.5 } } })
      var play = Bodies.rectangle(700, 0, 208, 71, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/08.png', xScale: 0.5, yScale: 0.5 } } })
      var climb = Bodies.rectangle(400, 0, 249, 62, { render: { sprite: { texture: 'https://maria-studiodialect.github.io/hosted-assets/09.png', xScale: 0.5, yScale: 0.5 } } })
      
      // add all bodies (boundaries and circles) to the world
        
      bodies.push(climb, play, kick, bend, lift, push, stretch, sprint, dance);
      Composite.add(world, bodies);

      let intervalID;

      function changeGravity() {
        if (!intervalID) {
          intervalID = setInterval(setGravity, 3000);
        }
      }

      let intervalNumber = 1;
      function setGravity() {
        if (intervalNumber === 1) {
          // console.log("interval " + intervalNumber + ", down");
          world.gravity.y = 0.5;
          world.gravity.x = 0;
          intervalNumber += 1;
        } else if (intervalNumber === 2) {
          // console.log("interval " + intervalNumber + ", up");
          world.gravity.y = -0.5;
          world.gravity.x = 0;
          intervalNumber += 1;
        } else if (intervalNumber === 3) {
          // console.log("interval " + intervalNumber + ", right");
          world.gravity.x = 0.5;
          world.gravity.y = 0;
          intervalNumber += 1;
        } else {
          // console.log("interval " + intervalNumber + ", left");
          world.gravity.x = -0.5;
          world.gravity.y = 0;
          intervalNumber = 1;
        }
      }

      // hold in place for testing
      // world.gravity.y = 0;
      // world.gravity.x = 0;

      changeGravity();
      break;  
  }


  // return a context for MatterDemo to control
  let data = {
    choice,
    attractiveBody,
    Body,
    engine: engine,
    runner: runner,
    render: render,
    canvas: render.canvas,
    stop: function () {
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
    },
    play: function () {
      Matter.Runner.run(runner, engine);
      Matter.Render.run(render);
    }
  };
  Matter.Runner.run(runner, engine);
  Matter.Render.run(render);
  return data;
}

function debounce(func, wait, immediate) {
  var timeout;
  return function () {
    var context = this, args = arguments;
    var later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
};

function setWindowSize() {
  let dimensions = {};
  dimensions.width = 3072;
  dimensions.height = 1728;

  m.render.canvas.width = 3072;
  m.render.canvas.height = 1728;
  return dimensions;
}

let m = runMatter(1)
setWindowSize()
$(window).resize(debounce(setWindowSize, 250))




