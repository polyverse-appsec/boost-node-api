// arn:aws:lambda:us-west-2:507760724064:function:cwsyn-boost-api-prod-test-4ea278b4-e39f-425b-8b2b-6fcbb14fd4ceå

const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');
const syntheticsConfiguration = synthetics.getConfiguration();

const apiCanaryBlueprint = async function () {
    // Configuration setup remains the same
    syntheticsConfiguration.setConfig({
        restrictedHeaders: [], // Value of these headers will be redacted from logs and reports
        restrictedUrlParameters: [] // Values of these url parameters will be redacted from logs and reports
    });

    // Header setup remains the same
    const headers = {
        'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6Im1vbml0b3JAcG9seXRlc3QuYWkifQ.dLDYDOYTh8htRhw6eHaBMsF4jIPe23SBOybeyOoZ02g0ZTXGhX4yiV904-42YTiOzbD0sjRPWIJsi0ZAnxN9ln5YPKwPnjOnsgRDp82FxM0lsaitAD7_OaIMVA7sg8zzIWrTvTKPEfgsPtqDibI3pkL_IQwEHBmnGHZbv2UwX-39l6RWcU14S-QxdNVHB8U8Ux56SjupwD3GE31A2EtQnmK5DkcH2j6afOgu-o9WQpbLmPhfwtuvGrWcyRFpMzzsxkH_uFxoLBgd_YogeDNvKDGLk97J3T_Vz7tPKQSLKjhelRlVMg20Z-bmKWUxB9F7boc3wpbe4sixUJ34gD3k7Q'
    };

    // Diagnostic validation function
    const validateSuccessful = async function (response) {
        return new Promise((resolve, reject) => {
            // Immediately log response status code and headers for diagnostics
            log.info(`Response Status Code: ${response.statusCode}`);
            log.info(`Response Headers: ${JSON.stringify(response.headers)}`);

            let responseBody = '';
            response.on('data', (d) => {
                responseBody += d;
            });

            response.on('end', () => {
                // Log the response body for further diagnostics
                log.info('Response body: ' + responseBody);
                
                // Check for successful response status codes
                if (response.statusCode < 200 || response.statusCode > 299) {
                    reject(new Error(`${response.statusCode} ${response.statusMessage}`));
                } else {
                    resolve();
                }
            });
        });
    };

    var stepConfig = {
        'continueOnStepFailure': true
    };

    // Diagnostic step to check internet connectivity and DNS resolution
    const diagnosticStep = async function() {
        await synthetics.executeStep('Verify Step', async function (timeoutInMillis = 1000) {
            console.log("Diagnostic Step completed", stepConfig);
        });
    };

    // Execute diagnostic step
    await diagnosticStep();

    // Diagnostic step to check internet connectivity and DNS resolution
    const diagnosticHttpStep = async function() {

        let requestOptions = {
            'hostname': 'httpbin.org',
            'method': 'GET',
            'path': '/get',
            'port': 443,
            'protocol': 'https:'
        };

        const diagnosticUrl = 'https://httpbin.org/get'; // A known endpoint for testing
        await synthetics.executeHttpStep('Diagnostic Http Step', requestOptions, async function(res) {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => log.info('Diagnostic response body: ' + responseBody));
        });
    };

    // Execute diagnostic step
    await diagnosticHttpStep();

    // Diagnostic step to execute and log detailed request and response info
    console.log("Executing HTTP Step with diagnostics...");

    let accountParams = {
        'hostname': '33pdosoitl22c42c7sf46tabi40qwlae.lambda-url.us-west-2.on.aws',
        'method': 'GET',
        'path': '/api/user/polyverse-appsec/account', // The path is the part of the URL after the hostname and before the querystring
        'port': 443,
        'protocol': 'https:',
        'headers': headers,
    };
    
    log.info("Account Step Parameters: " + JSON.stringify(accountParams));

    // Execute the HTTP request with detailed diagnostics
    try {
        await synthetics.executeHttpStep('Verify Account Information', accountParams, validateSuccessful);
    } catch (error) {
        // Log any errors encountered during the request execution
        log.error('Request failed:', error);
    }
};

exports.handler = async () => {
    return await apiCanaryBlueprint();
};
