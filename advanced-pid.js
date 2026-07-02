/**
 * advanced-pid.js - Copyright 2025, Marc Alzen @ Rasche & Wessler GmbH.
 *
 * This Node-RED node is based on the work of Harshad Joshi (node-red-contrib-easy-pid-controller).
 *
 * Licensed under the GNU General Public License, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 **/

const PIDController = require('advanced-pid-controller');

module.exports = function(RED) {
    function AdvancedPIDControllerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        let controller = null;

        // Read and parse configuration parameters from the node's settings.
        try {
            node.k_p = Number(config.k_p);
            node.k_i = Number(config.k_i);
            node.k_d = Number(config.k_d);
            node.dt = Number(config.dt);
            node.output_min = Number(config.output_min);
            node.output_max = Number(config.output_max);
            node.deadband = Number(config.deadband);
            node.useCodesysI = config.useCodesysI === true;
            node.i_clamp = Number(config.i_clamp) || 0;
        } catch (error) {
            node.error("Error parsing configuration parameters: " + error.message);
            return;
        }

        // --- Node's internal state variables ---
        node.mode = 2; // Default mode is 2 (Off)
        node.processValue = 0;
        node.manualValue = 0;
        node.autoEnable = true; // Auto mode enable flag, defaults to true.

        // Validate that all necessary parameters are valid numbers.
        if (isNaN(node.k_p) || isNaN(node.k_i) || isNaN(node.k_d) || isNaN(node.dt) || isNaN(node.output_min) || isNaN(node.output_max) || isNaN(node.deadband) || isNaN(node.i_clamp)) {
            node.error("Invalid parameters: Ensure all configuration values are numbers.");
            return;
        }
        if (node.dt <= 0) {
            node.error("Invalid parameter: dt (time interval) must be greater than 0.");
            return;
        }

        // Initialize the PID controller with the provided settings.
        try {
            controller = new PIDController(node.k_p, node.k_i, node.k_d, node.dt, node.output_min, node.output_max, node.deadband, node.useCodesysI, node.i_clamp);
        } catch (error) {
            node.error("Error creating PID Controller: " + error.message);
            return;
        }

        let pidTimer = null;

        // Stops the PID calculation interval and resets the controller's internal state.
        function stopPID() {
            if (pidTimer !== null) {
                clearInterval(pidTimer);
                pidTimer = null;
                controller.reset();
            }
        }

        // Starts the PID calculation interval for automatic mode.
        function startPID() {
            stopPID(); // Ensure no multiple timers are running.
            pidTimer = setInterval(function() {
                // The timer only sends output when in auto mode AND enabled.
                if (node.mode === 0 && node.autoEnable === true) {
                    let pidOutput = controller.update(node.processValue);
                    sendOutputs(pidOutput, true);
                }
            }, node.dt * 1000);
        }

        // Bundles and sends messages to the node's three outputs.
        function sendOutputs(analogValue, digitalEnable) {
            // Output 1: Full status object
            const msgFullStatus = {
                payload: {
                    PV: node.processValue,
                    SV: controller.target,
                    P: controller.p,
                    I: controller.i,
                    D: controller.d,
                    deadband: controller.deadband,
                    useCodesysI: controller.useCodesysI,
                    iClamp: controller.iClamp,
                    Output: analogValue
                }
            };

            // Output 2: Digital enable (boolean)
            const msgDigitalEnable = {
                payload: digitalEnable
            };

            // Output 3: Simple analog value (number)
            const msgSimpleOutput = {
                payload: analogValue
            };

            // Send messages to the three outputs in order.
            node.send([msgFullStatus, msgDigitalEnable, msgSimpleOutput]);
        }

        // Set the initial visual status of the node.
        node.status({ fill: "grey", shape: "ring", text: "Off (2)" });

        node.on('input', function(msg) {
            try {
                // Update the controller's target setpoint.
                if (msg.topic === 'SV') {
                    controller.setTarget(msg.payload);
                }

                // Update the value used in manual mode.
                if (msg.topic === 'manualValue') {
                    if (typeof msg.payload === 'number') {
                        node.manualValue = msg.payload;
                    }
                }

                // Update the current process value.
                if (msg.topic === 'PV') {
                    if (typeof msg.payload === 'number') {
                        node.processValue = msg.payload;
                    }
                }
                
                // Update the auto enable flag.
                if (msg.topic === 'autoEnable') {
                    node.autoEnable = (msg.payload === true);
                }

                // Update the useCodesysI flag dynamically.
                if (msg.topic === 'useCodesysI') {
                    node.useCodesysI = (msg.payload === true);
                    controller.useCodesysI = node.useCodesysI;
                }

                // Update the integral clamp limit dynamically.
                if (msg.topic === 'iClamp' || msg.topic === 'i_clamp') {
                    if (typeof msg.payload === 'number' && msg.payload >= 0) {
                        node.i_clamp = msg.payload;
                        controller.iClamp = node.i_clamp;
                    }
                }

                // Set the operational mode based on an integer input.
                if (msg.topic === 'mode') {
                    const newMode = parseInt(msg.payload, 10);
                    if (newMode >= 0 && newMode <= 2) {
                        node.mode = newMode;
                    }
                }

                // Execute logic based on the current operational mode.
                switch (node.mode) {
                    case 0: // Auto Mode
                        // Check the autoEnable flag within auto mode.
                        if (node.autoEnable === true) {
                            node.status({ fill: "green", shape: "dot", text: "Auto (0) - Running" });
                            if (pidTimer === null) {
                                startPID();
                            }
                        } else {
                            node.status({ fill: "yellow", shape: "ring", text: "Auto (0) - Paused" });
                            stopPID();
                            sendOutputs(0.0, false); // Send 0.0 and disable while paused.
                        }
                        // Output is handled by the setInterval callback or the logic above.
                        break;
                    case 1: // Manual Mode
                        stopPID();
                        node.status({ fill: "blue", shape: "dot", text: "Manual (1)" });
                        sendOutputs(node.manualValue, true); // Output the manual value directly.
                        break;
                    case 2: // Off Mode
                        stopPID();
                        node.status({ fill: "grey", shape: "ring", text: "Off (2)" });
                        sendOutputs(0.0, false); // Output zero and disable.
                        break;
                }

            } catch (error) {
                node.error("Error handling input: " + error.message);
                node.status({ fill: "red", shape: "ring", text: "Error" });
            }
        });

        // Clean up the timer when the node is closed or redeployed.
        node.on('close', function() {
            stopPID();
        });
    }

    RED.nodes.registerType("advanced-pid-controller", AdvancedPIDControllerNode);
}