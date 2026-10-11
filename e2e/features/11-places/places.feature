Feature: Places map

  Scenario: A cluster bubble opens the photo list and the viewer walk
    Given I am signed in
    And I upload 3 photos with nearby locations through the places API
    When I open the places map over the uploaded photos
    Then the places map shows a cluster bubble with count 3
    When I click the cluster bubble
    Then the places panel lists 3 photos
    And the map view in the URL is unchanged
    When I click the first photo in the places panel
    Then the viewer is open on a placed photo
    When I go to the next photo in the viewer
    And I go to the next photo in the viewer
    Then the viewer walked every placed photo
    When I close the places viewer
    And the places panel lists 3 photos

  Scenario: The map view is mirrored into the URL and restored on reload
    Given I am signed in
    And I upload a photo with a location through the places API
    When I open "/places"
    Then the places map shows a single location marker
    And the URL holds the map view parameters
    When I zoom the map out with the Leaflet zoom control
    Then the map view parameters in the URL changed
    When I reload the page
    Then the URL still holds the same map view parameters
    And the places map shows a single location marker
    When I open "/places"
    Then the map fits the placed photo

  Scenario: The viewer overlays the map with clickable controls
    Given I am signed in
    And I upload a photo with a location through the places API
    When I open "/places"
    Then the places map shows a single location marker
    When I click the location marker
    Then the places panel lists a single photo
    When I click the first photo in the places panel
    Then the viewer opens above the map and stays clickable
    When I close the places viewer
    And the places panel lists a single photo

  Scenario: A video marker shows a play badge and selects without a popup
    Given I am signed in
    And I upload the video fixture with a location through the places API
    When I open "/places"
    Then the video marker shows a play badge
    When I click the location marker
    Then the video bubble is selected without a popup
    And the places panel lists a single photo
