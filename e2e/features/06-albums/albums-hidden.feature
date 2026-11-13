Feature: Albums hidden from the timeline

  Scenario: Hiding an album removes its photo from the timeline but not from the album
    Given I am signed in
    And I created an album via the API named "Hidden album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I hide the album from the timeline
    Then the album reports hidden from the timeline
    And my timeline does not contain the album photo
    And my timeline is empty
    And the timeline layout is empty
    And the album asset count is 1

  Scenario: Showing a hidden album puts its photo back on the timeline
    Given I am signed in
    And I created an album via the API named "Restored album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I hide the album from the timeline
    Then my timeline is empty
    When I show the album on the timeline
    Then my timeline still contains the album photo

  Scenario: Deleting a hidden album returns its photo to the timeline
    Given I am signed in
    And I created an album via the API named "Doomed hidden album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I hide the album from the timeline
    Then my timeline is empty
    When I delete the album via the API
    Then my timeline still contains the album photo

  Scenario: A normal album keeps its photo on the timeline
    Given I am signed in
    And I created an album via the API named "Ordinary album"
    And I uploaded an album photo
    When I add my album photo to the album
    Then my timeline still contains the album photo
    And the album asset count is 1

  Scenario: The album-scoped timeline still lists a hidden album's photos
    Given I am signed in
    And I created an album via the API named "Scoped hidden album"
    And I uploaded an album photo
    When I add my album photo to the album
    And I hide the album from the timeline
    Then my timeline does not contain the album photo
    And the album timeline contains the album photo

  Scenario: Hiding one album leaves another album's photo on the timeline
    Given I am signed in
    And I uploaded two album photos
    And I created an album via the API named "Visible album"
    When I add my second album photo to the album
    # the second album is created last because the steps target the most recently created album
    And I created an album via the API named "Hidden album"
    And I add my album photo to the album
    And I hide the album from the timeline
    Then my timeline does not contain the album photo
    And the timeline layout only omits the hidden photo

  Scenario: The timeline layout version changes after hiding
    Given I am signed in
    And I created an album via the API named "Fingerprinted album"
    And I uploaded an album photo
    When I add my album photo to the album
    Then the timeline layout version changes after hiding

  Scenario: Hiding an empty album changes nothing measurable
    Given I am signed in
    And I created an album via the API named "Empty hidden album"
    And I uploaded an album photo
    When I hide the album from the timeline
    Then the album reports hidden from the timeline
    And the album asset count is 0
    And my timeline still contains the album photo
